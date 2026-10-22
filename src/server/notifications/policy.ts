import "server-only";
import { z } from "zod";
import { serviceStatus } from "@/features/workspace/service-status";
import type { Entitlement } from "../vpn/contracts";

const safeText = (maximum: number) => z.string().min(1).max(maximum).refine(value => !/(?:ss:\/\/|postgres(?:ql)?:\/\/|bearer\s)/i.test(value));
export const noticePayload = z.strictObject({ title: safeText(100), message: safeText(800), action: safeText(40), observedAt: z.iso.datetime() });
export type NoticePayload = z.infer<typeof noticePayload>;
export type NoticeDraft = { userId: string; audience: "CUSTOMER" | "OWNER"; kind: string; dedupeKey: string; payload: NoticePayload; href: string };
export function notificationsEnabled(source = process.env) { return source.METRO_NOTIFICATIONS_ENABLED === "true"; }
export function statusNotice(userId: string, serviceId: string, snapshot: Entitlement, now: number): NoticeDraft | null {
  const state = serviceStatus(snapshot, now);
  const titles: Partial<Record<typeof state.condition, string>> = { LOW_DATA: "Your Secure Access data is running low", DATA_EXHAUSTED: "Your Secure Access data is used up", EXPIRED: "Your Secure Access subscription has ended", BOTH_EXHAUSTED: "Your Secure Access data and subscription have ended" };
  const title = titles[state.condition]; if (!title) return null;
  return { userId, audience: "CUSTOMER", kind: state.condition, dedupeKey: `status:${serviceId}:${snapshot.version}:${state.condition}`, href: "/plans", payload: { title, message: state.reasons.join(" "), action: state.renew && state.topUp ? "Renew and top up" : state.renew ? "Renew" : "Top up", observedAt: snapshot.observedAt! } };
}
export function supportNotice(userId: string, issueId: string, version: number, state: string, now: Date): NoticeDraft {
  return { userId, audience: "CUSTOMER", kind: "SUPPORT_UPDATED", dedupeKey: `support:${issueId}:${version}`, href: `/dashboard/secure-access#issue-${issueId}`, payload: { title: "Your Metro support ticket was updated", message: state === "TROUBLESHOOTING" ? "Metro's manual test succeeded. Follow the guided reimport and network checks in your ticket, with up to three attempts." : state === "REPLACEMENT_APPROVED" ? "Metro's manual test failed. A controlled key replacement has been authorized; keep checking your ticket for completion." : state === "RESOLVED" ? "Your support ticket is resolved. Open Secure Access for the latest verified status." : "Your connection issue is awaiting further Metro review.", action: "View support ticket", observedAt: now.toISOString() } };
}
