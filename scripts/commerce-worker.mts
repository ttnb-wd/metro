import "server-only";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../src/server/db/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPgPoolConfig } from "../src/server/db/connection-config";
import { productionFulfilmentWorker } from "../src/server/commerce/worker";
import { fulfilmentEnabled } from "../src/server/commerce/config";
import { assertWebsiteTargetUrl } from "../src/server/db/target-policy";

// Environment is injected by the reviewed process supervisor, never dotenv.
async function main() {
  if (!fulfilmentEnabled()) throw new Error("Execution gate is closed.");
  const raw = process.env.METRO_COMMERCE_WORKER_DATABASE_URL ?? "", url = new URL(raw);
  if (url.protocol !== "postgresql:" || decodeURIComponent(url.username) !== "metro_commerce_worker" || decodeURIComponent(url.pathname.slice(1)) !== "neondb" || url.searchParams.get("sslmode") !== "verify-full" || !url.hostname.endsWith(".neon.tech")) throw new Error("Approved worker database required.");
  // Pin the same reviewed endpoint, not just a provider suffix.
  assertWebsiteTargetUrl(raw, "metro_commerce_worker", url.hostname.includes("-pooler."));
  const db = new PrismaClient({ adapter: new PrismaPg(createPgPoolConfig(raw)), log: [], errorFormat: "minimal" });
  const [identity] = await db.$queryRaw<Array<{ database: string; role: string; unsafe: boolean }>>`SELECT current_database() AS database,current_user AS role,
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR has_schema_privilege(current_user,'public','CREATE')
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=pg_roles.oid)
      OR has_table_privilege(current_user,'metro_account','SELECT') OR has_table_privilege(current_user,'metro_session','SELECT')
      OR has_table_privilege(current_user,'metro_owner_binding','INSERT,UPDATE,DELETE,TRUNCATE')) AS unsafe FROM pg_roles WHERE rolname=current_user`;
  if (!identity || identity.database !== "neondb" || identity.role !== "metro_commerce_worker" || identity.unsafe) { await db.$disconnect(); throw new Error("Restricted worker identity required."); }
  const worker = productionFulfilmentWorker(db); let stop = false;
  process.once("SIGTERM", () => { stop = true; }); process.once("SIGINT", () => { stop = true; });
  let refreshed = 0;
  try { while (!stop) {
    for (let count = 0; count < 5 && !stop; count++) { if ((await worker.runOne()).status === "IDLE") break; }
    if (Date.now() - refreshed > 30000) { try { await worker.refreshServices(10); } catch { console.error("A service snapshot refresh will be retried."); } refreshed = Date.now(); }
    if (process.env.METRO_COMMERCE_WORKER_HEALTH_FILE === "/tmp/metro-commerce-worker-heartbeat") writeFileSync("/tmp/metro-commerce-worker-heartbeat", String(Date.now()), { mode: 0o600 });
    await new Promise(resolve => setTimeout(resolve, 2000));
  } }
  finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Commerce worker stopped safely. Check approved configuration and backend readiness."); process.exitCode = 1; });
