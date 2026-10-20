import "server-only";
import { readServerEnvironment } from "../env";
import { getPrisma } from "../db/client";
import { assertWebsiteDatabaseReady } from "../db/verify-target";
import { AUTH_TABLES, FOUNDATION_TABLES, WEBSITE_ROLES } from "../db/target-policy";
import { buildRepositories } from "./repositories";
import { FoundationError, createOwnerAuthorization } from "../owner/authorization";

async function foundationDatabase() {
  const environment = readServerEnvironment();
  if (!environment.enabled || !environment.foundationEnabled || environment.runtimeRole !== WEBSITE_ROLES.runtime) throw new FoundationError("DISABLED");
  try {
    await assertWebsiteDatabaseReady(environment);
    const db = getPrisma(environment);
    const [state] = await db.$queryRaw<Array<{ unsafe: boolean; tables: string[]; migrated: boolean }>>`
      SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication
        OR has_schema_privilege(current_user,'public','CREATE')
        OR pg_has_role(current_user,'pg_read_all_data','USAGE') OR pg_has_role(current_user,'pg_write_all_data','USAGE')
        OR pg_has_role(current_user,'metro_migrator','MEMBER') OR pg_has_role(current_user,'metro_owner_assign','MEMBER')
        OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
        OR has_table_privilege(current_user,'metro_owner_binding','INSERT,UPDATE,DELETE,TRUNCATE')) AS unsafe,
        ARRAY(SELECT tablename::text FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'metro_%' ORDER BY tablename)::text[] AS tables,
        EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='20261020010000_website_owner_foundation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrated
      FROM pg_roles WHERE rolname=current_user`;
    if (!state || state.unsafe || !state.migrated || JSON.stringify(state.tables) !== JSON.stringify([...AUTH_TABLES, ...FOUNDATION_TABLES].sort())) throw new Error();
    return db;
  } catch { throw new FoundationError("UNAVAILABLE"); }
}

// Production-ready factory, disabled until separately approved configuration.
// No public order/payment/admin endpoint or VPN transport is activated here.
export async function getWebsiteRepositories() { return buildRepositories(await foundationDatabase()); }
export async function getOwnerAuthorization() {
  const db = await foundationDatabase();
  return createOwnerAuthorization({ readBinding: async () => (await db.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } }))?.userId ?? null });
}
