import { defineConfig } from "prisma/config";
import { assertWebsiteTargetUrl, WEBSITE_ROLES } from "./src/server/db/target-policy";

// Explicit migration configuration, separate from offline code generation.
// A reviewed caller must supply the dedicated unpooled URL via the process
// environment. Never load secrets into source or use a pooled/legacy fallback.
function dedicatedMigrationUrl(): string {
  const value = process.env.METRO_DIRECT_DATABASE_URL;
  try {
    if (!value || process.env.METRO_AUTH_ENABLED !== "false") throw new Error();
    assertWebsiteTargetUrl(value, WEBSITE_ROLES.migration, false);
    return value;
  } catch { throw new Error("A reviewed dedicated Metro Neon direct connection with strict TLS and disabled authentication is required."); }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: dedicatedMigrationUrl() },
});
