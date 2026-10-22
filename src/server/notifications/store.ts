import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../db/generated/client";
import { notificationsEnabled, noticePayload, type NoticeDraft } from "./policy";
export async function queueNotice(tx: Prisma.TransactionClient, draft: NoticeDraft, enabled = notificationsEnabled()) {
  if (!enabled) return;
  await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
  const payload = noticePayload.parse(draft.payload);
  if (!/^\/(?:plans$|dashboard\/|admin\/)/.test(draft.href) || draft.href.includes("//") || draft.dedupeKey.length > 220) throw new Error("Invalid notification.");
  const id = randomUUID();
  await tx.websiteNotification.createMany({ data: [{ ...draft, id, payload }], skipDuplicates: true });
}
export async function notificationSchemaReady(db: PrismaClient) {
  const [row] = await db.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('public.metro_website_notification') IS NOT NULL AS ready`;
  return row?.ready === true;
}
