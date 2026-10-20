import "server-only";
import type { EnabledAuthEnvironment } from "@/server/env";
import { getPrisma } from "@/server/db/client";

const host = "ep-floral-lab-azihv1v9.c-3.ap-southeast-1.aws.neon.tech";
const tables = ["metro_account", "metro_rate_limit", "metro_session", "metro_user", "metro_verification"];

// Pin the approved website target; changing database/role requires review.
// Run before auth APIs/session reads, since reads may refresh session records.
export async function assertWebsiteDatabaseReady(environment: EnabledAuthEnvironment): Promise<void> {
  const url = new URL(environment.databaseUrl);
  if (url.hostname !== host.replace(".", "-pooler.") || decodeURIComponent(url.pathname.slice(1)) !== "neondb"
    || decodeURIComponent(url.username) !== "neondb_owner" || url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("Metro website database target is not approved.");
  }
  const [identity] = await getPrisma(environment).$queryRaw<Array<{ database: string; role: string; tables: string[]; migration: boolean }>>`
    SELECT current_database()::text AS database, current_user::text AS role,
      ARRAY(SELECT tablename::text FROM pg_tables WHERE schemaname='public'
        AND tablename::text IN ('metro_account','metro_rate_limit','metro_session','metro_user','metro_verification') ORDER BY tablename)::text[] AS tables,
      EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name='20261020000000_init_website_auth'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migration`;
  if (!identity || identity.database !== "neondb" || identity.role !== "neondb_owner"
    || !identity.migration || JSON.stringify(identity.tables) !== JSON.stringify(tables)) {
    throw new Error("Metro website authentication schema is not ready.");
  }
}
