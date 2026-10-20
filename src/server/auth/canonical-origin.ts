import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLoopbackHost, readServerEnvironment, type EnabledAuthEnvironment } from "@/server/env";
import { safeReturnPath } from "@/server/auth/redirects";

type AuthQuery = { next?: unknown; registered?: unknown; verified?: unknown };

export function canonicalAuthPageUrl(environment: EnabledAuthEnvironment, host: string | null, path: "/login" | "/register" | "/verify-email", query: AuthQuery): string | null {
  const configured = new URL(environment.origin);
  if (environment.nodeEnv === "production" || !isLoopbackHost(configured.hostname) || host === configured.host) return null;
  const aliases = ["localhost", "127.0.0.1", "[::1]"].map(hostname => {
    const alias = new URL(configured); alias.hostname = hostname; return alias.host;
  });
  if (!host || !aliases.includes(host)) return null;
  // Only GET page navigation redirects. Credentials are never forwarded
  // between origins, and auth POST/CSRF checks stay strict.
  const destination = new URL(path, configured);
  if (query.next !== undefined) destination.searchParams.set("next", safeReturnPath(query.next));
  if (path === "/login" && query.registered === "1") destination.searchParams.set("registered", "1");
  if (path === "/login" && query.verified === "1") destination.searchParams.set("verified", "1");
  return destination.href;
}

export async function canonicalizeAuthPage(path: "/login" | "/register" | "/verify-email", query: AuthQuery): Promise<void> {
  const environment = readServerEnvironment();
  if (!environment.enabled) return;
  const destination = canonicalAuthPageUrl(environment, (await headers()).get("host"), path, query);
  if (destination) redirect(destination);
}
