import { defineConfig } from "prisma/config";

// Explicit migration configuration, separate from offline code generation.
// A reviewed caller must supply the dedicated unpooled URL via the process
// environment. Never load secrets into source or use a pooled/legacy fallback.
function dedicatedMigrationUrl(): string {
  const value = process.env.METRO_DIRECT_DATABASE_URL;
  try {
    if (!value || process.env.METRO_AUTH_ENABLED !== "false") throw new Error();
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol)
      || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)
      || url.hostname.split(".")[0].endsWith("-pooler") || /aiven/i.test(url.hostname)
      || !url.username || !url.password || url.pathname.length < 2
      || url.searchParams.getAll("sslmode").length !== 1 || url.searchParams.get("sslmode") !== "verify-full"
      || [...url.searchParams.keys()].some(key => !["sslmode", "channel_binding", "application_name"].includes(key))) throw new Error();
    return value;
  } catch { throw new Error("A reviewed dedicated Metro Neon direct connection with strict TLS and disabled authentication is required."); }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: dedicatedMigrationUrl() },
});
