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
  const raw = process.env.METRO_COMMERCE_WORKER_DATABASE_URL ?? "", url = new URL(raw);
  if (url.protocol !== "postgresql:" || decodeURIComponent(url.username) !== "metro_commerce_worker" || decodeURIComponent(url.pathname.slice(1)) !== "neondb" || url.searchParams.get("sslmode") !== "verify-full" || !url.hostname.endsWith(".neon.tech")) throw new Error("Approved worker database required.");
  // Pin the same reviewed endpoint, not just a provider suffix.
  assertWebsiteTargetUrl(raw, "metro_commerce_worker", url.hostname.includes("-pooler."));
  const db = new PrismaClient({ adapter: new PrismaPg({ ...createPgPoolConfig(raw), max: 2, options: "-c TimeZone=UTC", application_name: "metro_website_commerce_v2" }), log: [], errorFormat: "minimal" });
  try {
  const [identity] = await db.$queryRaw<Array<{ database: string; role: string; project: string; branch: string; unsafe: boolean }>>`SELECT current_database() AS database,current_user AS role,current_setting('neon.project_id',true) AS project,current_setting('neon.branch_id',true) AS branch,
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR has_schema_privilege(current_user,'public','CREATE')
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=pg_roles.oid)
      OR has_table_privilege(current_user,'metro_account','SELECT') OR has_table_privilege(current_user,'metro_session','SELECT')
      OR has_table_privilege(current_user,'metro_payment_decision','INSERT,UPDATE,DELETE')
      OR has_column_privilege(current_user,'metro_payment_evidence','storageRef','SELECT')
      OR has_table_privilege(current_user,'metro_owner_binding','INSERT,UPDATE,DELETE,TRUNCATE')) AS unsafe FROM pg_roles WHERE rolname=current_user`;
  if (!identity || identity.database !== "neondb" || identity.role !== "metro_commerce_worker" || identity.project !== "proud-band-76846516" || identity.branch !== "br-gentle-night-azuks958" || identity.unsafe) { await db.$disconnect(); throw new Error("Restricted worker identity required."); }
  // A disabled process still verifies the permissions needed after activation.
  await db.$queryRaw`SELECT slot,"userId" FROM metro_owner_binding LIMIT 0`;
  await db.$queryRaw`SELECT id,"emailVerified" FROM metro_user LIMIT 0`;
  await db.$queryRaw`SELECT id,"orderId","userId",decision,"ownerId","evidenceId","amountMmk","reasonCode" FROM metro_payment_decision LIMIT 0`;
  await db.$queryRaw`SELECT id,"orderId","userId" FROM metro_payment_evidence LIMIT 0`;
  await db.$queryRaw`SELECT id,"actorId","targetUserId",action,"resourceId","reasonCode",outcome FROM metro_owner_audit LIMIT 0`;
  await db.$queryRaw`SELECT id,"issueId","userId","actorId",kind,version FROM metro_issue_event LIMIT 0`;
  const worker = productionFulfilmentWorker(db); let stop = false;
  process.once("SIGTERM", () => { stop = true; }); process.once("SIGINT", () => { stop = true; });
  let refreshed = 0;
  while (!stop) {
    // One remote operation per loop bounds connection pressure and lets health
    // and shutdown progress between operations.
    if (!stop) await worker.runOne();
    if (process.env.METRO_VPN_OBSERVATION_ENABLED === "true" && Date.now() - refreshed > 30000) { try { await worker.refreshServices(10); } catch { console.error("A service snapshot refresh will be retried."); } refreshed = Date.now(); }
    if (process.env.METRO_COMMERCE_WORKER_HEALTH_FILE === "/tmp/metro-commerce-worker-heartbeat") {
      writeFileSync("/tmp/metro-commerce-worker-heartbeat", String(Date.now()), { mode: 0o600 });
      writeFileSync("/tmp/metro-commerce-worker-state.json", JSON.stringify({ version: "metro-website-worker.v2", observedAt: new Date().toISOString(), mode: fulfilmentEnabled() ? "ACTIVE" : "DISABLED", observationEnabled: process.env.METRO_VPN_OBSERVATION_ENABLED === "true", receiptProtocol: "metro-fulfilment-receipt.v1", databaseVerified: true, concurrency: 1, poolMaximum: 2 }), { mode: 0o600 });
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  } }
  finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Commerce worker stopped safely. Check approved configuration and backend readiness."); process.exitCode = 1; });
