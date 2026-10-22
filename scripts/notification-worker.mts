import "server-only";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../src/server/db/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPgPoolConfig } from "../src/server/db/connection-config";
import { assertWebsiteTargetUrl } from "../src/server/db/target-policy";
import { buildNotificationWorker } from "../src/server/notifications/worker";
import { notificationEmail } from "../src/server/notifications/email";
import { notificationsEnabled } from "../src/server/notifications/policy";
import { readSmtpEnvironment } from "../src/server/email/verification";
async function main() {
  if (!notificationsEnabled()) throw new Error("Notification execution gate is closed.");
  const raw = process.env.METRO_NOTIFICATION_WORKER_DATABASE_URL ?? "", url = new URL(raw);
  assertWebsiteTargetUrl(raw, "metro_notifications_worker", url.hostname.includes("-pooler."));
  const origin = process.env.BETTER_AUTH_URL ?? "";
  const emailEnabled = process.env.METRO_NOTIFICATION_EMAIL_ENABLED === "true";
  if (emailEnabled) {
    if (process.env.NODE_ENV === "production" && new URL(origin).protocol !== "https:") throw new Error("Public HTTPS website origin required before customer email activation.");
    notificationEmail(origin, "/dashboard/secure-access", { title: "Configuration check", message: "Configuration check", action: "Open Metro", observedAt: new Date().toISOString() }); readSmtpEnvironment();
  }
  const db = new PrismaClient({ adapter: new PrismaPg(createPgPoolConfig(raw)), log: [] });
  try {
    const [identity] = await db.$queryRaw<Array<{ role: string; unsafe: boolean }>>`SELECT current_user AS role,(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
      OR has_schema_privilege(current_user,'public','CREATE') OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)
      OR has_table_privilege(current_user,'metro_account','SELECT') OR has_table_privilege(current_user,'metro_session','SELECT')
      OR has_table_privilege(current_user,'metro_website_order','INSERT,UPDATE,DELETE')
      OR has_table_privilege(current_user,'metro_owner_binding','INSERT,UPDATE,DELETE')) AS unsafe FROM pg_roles WHERE rolname=current_user`;
    if (identity?.role !== "metro_notifications_worker" || identity.unsafe) throw new Error("Restricted notification identity required.");
    let stop = false; process.once("SIGINT", () => { stop = true; }); process.once("SIGTERM", () => { stop = true; });
    const worker = buildNotificationWorker(db, origin);
    while (!stop) {
      // Retain queued deliveries without claiming or sending them until the
      // public website URL and email execution gate are explicitly configured.
      if (emailEnabled) await worker.runOne();
      if (process.env.METRO_NOTIFICATION_WORKER_HEALTH_FILE === "/tmp/metro-notification-worker-heartbeat") writeFileSync("/tmp/metro-notification-worker-heartbeat", String(Date.now()), { mode: 0o600 });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Notification worker stopped safely. Check approved configuration and delivery state."); process.exitCode = 1; });
