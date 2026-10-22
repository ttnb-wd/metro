import "server-only";
import { z } from "zod";

type EnvironmentSource = Record<string, string | undefined>;

const gateSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  METRO_AUTH_ENABLED: z.enum(["false", "true"]).default("false"),
});

export function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

const databaseUrlSchema = z.string().url().superRefine((value, context) => {
  let url: URL;
  try { url = new URL(value); } catch { return; }
  const database = url.pathname.slice(1);
  const allowedQuery = new Set(["sslmode", "application_name", "channel_binding"]);
  const channelBinding = url.searchParams.get("channel_binding");
  const valid = ["postgres:", "postgresql:"].includes(url.protocol)
    && !!url.hostname && !!url.username && !!url.password
    && !!database && !["postgres", "template0", "template1"].includes(database)
    && !url.hash
    && [...url.searchParams.keys()].every(key => allowedQuery.has(key))
    && url.searchParams.getAll("sslmode").length <= 1
    && url.searchParams.getAll("channel_binding").length <= 1
    && [null, "prefer", "require"].includes(channelBinding)
    && (channelBinding !== "require" || url.searchParams.get("sslmode") === "verify-full")
    && (isLoopbackHost(url.hostname)
      ? [null, "disable", "verify-full"].includes(url.searchParams.get("sslmode"))
      : url.searchParams.get("sslmode") === "verify-full");
  if (!valid) context.addIssue({ code: "custom", message: "Use a dedicated PostgreSQL database; remote connections require sslmode=verify-full." });
});

const enabledSchema = gateSchema.extend({
  METRO_DATABASE_URL: databaseUrlSchema,
  METRO_DIRECT_DATABASE_URL: databaseUrlSchema.optional(),
  // Transitional legacy access remains explicit until the approved role cutover.
  METRO_DATABASE_RUNTIME_ROLE: z.enum(["neondb_owner", "metro_runtime"]).default("neondb_owner"),
  METRO_WEBSITE_FOUNDATION_ENABLED: z.enum(["false", "true"]).default("false"),
  BETTER_AUTH_SECRET: z.string().min(32).max(512).refine(value =>
    !/^(.)\1+$/.test(value)
    && !/(?:replace[-_ ]?me|change[-_ ]?me|your[-_ ]?(?:auth[-_ ]?)?secret|^example)/i.test(value)),
  BETTER_AUTH_URL: z.string().url().superRefine((value, context) => {
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      context.addIssue({ code: "custom", message: "Set the exact website origin, without credentials, path, query, or fragment." });
    }
  }),
  // Only configure after reviewing a proxy that overwrites this header.
  METRO_AUTH_TRUSTED_IP_HEADER: z.enum(["x-real-ip", "cf-connecting-ip"]).optional(),
}).superRefine((value, context) => {
  if (value.METRO_DATABASE_RUNTIME_ROLE === "metro_runtime" && value.METRO_DIRECT_DATABASE_URL !== undefined) {
    context.addIssue({ code: "custom", path: ["METRO_DIRECT_DATABASE_URL"], message: "Restricted runtime must not receive operator credentials." });
  }
  if (value.METRO_WEBSITE_FOUNDATION_ENABLED === "true" && value.METRO_DATABASE_RUNTIME_ROLE !== "metro_runtime") {
    context.addIssue({ code: "custom", path: ["METRO_DATABASE_RUNTIME_ROLE"], message: "Website foundation requires the restricted runtime role." });
  }
  let url: URL;
  try { url = new URL(value.BETTER_AUTH_URL); } catch { return; }
  if (url.protocol !== "https:" && (value.NODE_ENV === "production" || !isLoopbackHost(url.hostname))) {
    context.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "HTTPS is required except for loopback development." });
  }
});

export class EnvironmentConfigurationError extends Error {
  constructor(fields: string[]) {
    // Never include Zod's input, issue details, connection URLs, or secrets.
    super(`Invalid Metro authentication environment: ${[...new Set(fields)].sort().join(", ")}`);
    this.name = "EnvironmentConfigurationError";
  }
}

export type EnabledAuthEnvironment = {
  enabled: true;
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  directDatabaseUrl?: string;
  secret: string;
  origin: string;
  trustedIpHeader?: "x-real-ip" | "cf-connecting-ip";
  runtimeRole?: "neondb_owner" | "metro_runtime";
  foundationEnabled?: boolean;
};

export type AuthEnvironment = EnabledAuthEnvironment | {
  enabled: false;
  nodeEnv: "development" | "test" | "production";
};

export function parseServerEnvironment(source: EnvironmentSource): AuthEnvironment {
  const gate = gateSchema.safeParse(source);
  if (!gate.success) throw new EnvironmentConfigurationError(gate.error.issues.map(issue => String(issue.path[0])));
  // Disabled means no database URL or secret is read, required, or initialized.
  if (gate.data.METRO_AUTH_ENABLED === "false") return { enabled: false, nodeEnv: gate.data.NODE_ENV };
  const result = enabledSchema.safeParse(source);
  if (!result.success) throw new EnvironmentConfigurationError(result.error.issues.map(issue => String(issue.path[0])));
  if (source.VERCEL === "1") {
    const forbidden = ["METRO_DIRECT_DATABASE_URL", "METRO_COMMERCE_WORKER_DATABASE_URL", "METRO_NOTIFICATION_WORKER_DATABASE_URL"].filter(key => source[key]);
    if (result.data.METRO_DATABASE_RUNTIME_ROLE !== "metro_runtime") forbidden.push("METRO_DATABASE_RUNTIME_ROLE");
    const target = new URL(result.data.METRO_DATABASE_URL);
    if (!target.hostname.endsWith(".neon.tech") || !target.hostname.includes("-pooler.") || decodeURIComponent(target.username) !== "metro_runtime") forbidden.push("METRO_DATABASE_URL");
    if (forbidden.length) throw new EnvironmentConfigurationError(forbidden);
  }
  return {
    enabled: true,
    nodeEnv: result.data.NODE_ENV,
    databaseUrl: result.data.METRO_DATABASE_URL,
    directDatabaseUrl: result.data.METRO_DIRECT_DATABASE_URL,
    secret: result.data.BETTER_AUTH_SECRET,
    origin: new URL(result.data.BETTER_AUTH_URL).origin,
    trustedIpHeader: result.data.METRO_AUTH_TRUSTED_IP_HEADER,
    runtimeRole: result.data.METRO_DATABASE_RUNTIME_ROLE,
    foundationEnabled: result.data.METRO_WEBSITE_FOUNDATION_ENABLED === "true",
  };
}

export function readServerEnvironment(): AuthEnvironment {
  // No DATABASE_URL, Aiven, Telegram, NEXT_PUBLIC_*, or host-header fallback.
  return parseServerEnvironment({
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    METRO_AUTH_ENABLED: process.env.METRO_AUTH_ENABLED,
    METRO_DATABASE_URL: process.env.METRO_DATABASE_URL,
    METRO_DIRECT_DATABASE_URL: process.env.METRO_DIRECT_DATABASE_URL,
    METRO_DATABASE_RUNTIME_ROLE: process.env.METRO_DATABASE_RUNTIME_ROLE,
    METRO_WEBSITE_FOUNDATION_ENABLED: process.env.METRO_WEBSITE_FOUNDATION_ENABLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    METRO_AUTH_TRUSTED_IP_HEADER: process.env.METRO_AUTH_TRUSTED_IP_HEADER,
    METRO_COMMERCE_WORKER_DATABASE_URL: process.env.METRO_COMMERCE_WORKER_DATABASE_URL,
    METRO_NOTIFICATION_WORKER_DATABASE_URL: process.env.METRO_NOTIFICATION_WORKER_DATABASE_URL,
  });
}
