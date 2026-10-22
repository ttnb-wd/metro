import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../db/generated/client";
import { notificationsEnabled, noticePayload, statusNotice, type NoticePayload } from "./policy";
import { liveServiceStatus } from "../vpn/live-status";
import { sendNotificationEmail, type DeliveryOutcome } from "./email";
type Sender = (input: { id: string; email: string; origin: string; href: string; payload: NoticePayload }) => Promise<DeliveryOutcome>;
export function buildNotificationWorker(db: PrismaClient, origin: string, send: Sender = sendNotificationEmail, enabled = notificationsEnabled(), refresh = liveServiceStatus) {
  return { async runOne() {
    if (!enabled) return { status: "DISABLED" };
    const leaseId = randomUUID();
    const notice = await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM metro_website_notification
        WHERE "emailState" IN ('PENDING','RETRY','SENDING') AND "emailAvailableAt" <= clock_timestamp()
        AND ("emailState"<>'SENDING' OR "emailLeaseUntil"<clock_timestamp())
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!row) return null;
      const current = await tx.websiteNotification.findUniqueOrThrow({ where: { id: row.id } });
      if (current.emailState === "SENDING") {
        // SMTP cannot guarantee exactly-once acceptance. Quarantine an expired
        // send rather than risk automatically duplicating a customer warning.
        await tx.websiteNotification.update({ where: { id: row.id }, data: { emailState: "UNCERTAIN", emailErrorCode: "SEND_CONFIRMATION_LOST", emailLeaseId: null, emailLeaseUntil: null } });
        return null;
      }
      return tx.websiteNotification.update({ where: { id: row.id }, data: { emailState: "SENDING", emailErrorCode: null, emailLeaseId: leaseId, emailLeaseUntil: new Date(Date.now() + 120000), emailAttempts: { increment: 1 } } });
    });
    if (!notice) return { status: "IDLE" };
    let outcome: DeliveryOutcome | "SUPPRESSED" = "UNCERTAIN";
    try {
      const user = await db.user.findUniqueOrThrow({ where: { id: notice.userId }, select: { email: true, emailVerified: true } });
      if (!user.emailVerified) outcome = "SUPPRESSED";
      else {
        const match = /^status:([^:]+):([0-9]+):([A-Z_]+)$/.exec(notice.dedupeKey);
        if (match) {
          const service = await db.websiteServiceReference.findFirst({ where: { id: match[1], userId: notice.userId } });
          const live = service ? await refresh(service) : null;
          const current = live?.entitlement && service ? statusNotice(notice.userId, service.id, live.entitlement, Date.now()) : null;
          if (!live?.entitlement || !live.status.usageKnown) outcome = "RETRY";
          else if (!current || current.dedupeKey !== notice.dedupeKey) outcome = "SUPPRESSED";
          else outcome = await send({ id: notice.id, email: user.email, origin, href: current.href, payload: current.payload });
        } else {
          const support = /^support:([^:]+):([0-9]+)$/.exec(notice.dedupeKey);
          const issue = support ? await db.supportIssue.findFirst({ where: { id: support[1], userId: notice.userId }, select: { version: true } }) : null;
          if (support && (!issue || issue.version !== Number(support[2]))) outcome = "SUPPRESSED";
          else outcome = await send({ id: notice.id, email: user.email, origin, href: notice.href, payload: noticePayload.parse(notice.payload) });
        }
      }
    } catch { outcome = "UNCERTAIN"; }
    const retry = outcome === "RETRY" && notice.emailAttempts < 8, state = outcome === "RETRY" && !retry ? "FAILED" : outcome;
    await db.websiteNotification.updateMany({ where: { id: notice.id, userId: notice.userId, emailLeaseId: leaseId, emailState: "SENDING", emailLeaseUntil: { gt: new Date() } }, data: { emailState: state, emailSentAt: state === "SENT" ? new Date() : null, emailErrorCode: ["FAILED", "UNCERTAIN"].includes(state) ? `DELIVERY_${state}` : null, emailLeaseId: null, emailLeaseUntil: null, emailAvailableAt: new Date(Date.now() + Math.min(3600, 15 * 2 ** notice.emailAttempts) * 1000) } });
    return { status: outcome };
  } };
}
