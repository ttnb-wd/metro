import "server-only";
import type { EnabledAuthEnvironment } from "@/server/env";
import { getPrisma } from "@/server/db/client";
import { assertWebsiteTargetUrl, AUTH_TABLES, WEBSITE_DATABASE } from "./target-policy";

// Pin host/database and the separately configured runtime role. No migration
// credential is used here; legacy auth keeps working until approved cutover.
// Run before auth APIs/session reads, since reads may refresh session records.
export async function assertWebsiteDatabaseReady(environment: EnabledAuthEnvironment): Promise<void> {
  const role = environment.runtimeRole ?? "neondb_owner";
  assertWebsiteTargetUrl(environment.databaseUrl, role, true);
  const [identity] = await getPrisma(environment).$queryRaw<Array<{ database: string; role: string; tables: string[]; migration: boolean }>>`
    SELECT current_database()::text AS database, current_user::text AS role,
      ARRAY(SELECT tablename::text FROM pg_tables WHERE schemaname='public'
        AND tablename::text IN ('metro_account','metro_rate_limit','metro_session','metro_user','metro_verification') ORDER BY tablename)::text[] AS tables,
      EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name='20261020000000_init_website_auth'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migration`;
  if (!identity || identity.database !== WEBSITE_DATABASE || identity.role !== role
    || !identity.migration || JSON.stringify(identity.tables) !== JSON.stringify(AUTH_TABLES)) {
    throw new Error("Metro website authentication schema is not ready.");
  }
}
