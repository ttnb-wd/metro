import { formatMyanmarTime } from "@/lib/myanmar-time";
import "server-only";
import { z } from "zod";
import { createVerificationTransport } from "../email/verification";
import { noticePayload, type NoticePayload } from "./policy";
export type DeliveryOutcome = "SENT" | "RETRY" | "FAILED" | "UNCERTAIN";
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function notificationEmail(origin: string, href: string, input: NoticePayload) {
  const base = new URL(origin), payload = noticePayload.parse(input);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname))) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !/^\/(?:plans$|dashboard\/|admin\/)/.test(href) || href.includes("//")) throw new Error("Invalid notification destination.");
  const url = new URL(href, base).href;
  return { subject: payload.title, text: `METRO\n\n${payload.title}\n\n${payload.message}\n\nRecorded at ${formatMyanmarTime(payload.observedAt)}. Open Metro for current status.\n${payload.action}: ${url}\n\nMetro never includes VPN keys, payment proof or sign-in tokens in service emails.`,
    html: `<!doctype html><html lang="en"><meta charset="utf-8"><body style="margin:0;background:#eef4fa;color:#10243d;font-family:Arial,sans-serif"><main style="max-width:540px;margin:32px auto;padding:32px;background:white;border-radius:16px"><p style="color:#075cb5;letter-spacing:3px;font-weight:bold">METRO</p><h1 style="font-size:26px">${escape(payload.title)}</h1><p style="line-height:1.7">${escape(payload.message)}</p><p><a style="display:inline-block;background:#075cb5;color:white;padding:14px 20px;border-radius:8px;text-decoration:none" href="${escape(url)}">${escape(payload.action)}</a></p><p style="font-size:13px;line-height:1.6">Recorded at ${escape(formatMyanmarTime(payload.observedAt))}. Open Metro for current status.</p><p style="font-size:12px">No VPN credentials or payment proof are included in this email.</p></main></body></html>` };
}
export function deliveryFailure(error: unknown): DeliveryOutcome {
  const value = z.object({ responseCode: z.number().optional(), command: z.string().optional(), code: z.string().optional() }).safeParse(error);
  if (!value.success) return "UNCERTAIN";
  const { responseCode, command, code } = value.data;
  if (responseCode && responseCode >= 400 && responseCode < 500) return "RETRY";
  if (responseCode && responseCode >= 500 || code === "EAUTH" || code === "EENVELOPE") return "FAILED";
  if (command === "CONN" || code === "EDNS") return "RETRY";
  return "UNCERTAIN";
}
export async function sendNotificationEmail(input: { id: string; email: string; origin: string; href: string; payload: NoticePayload }): Promise<DeliveryOutcome> {
  if (!z.uuid().safeParse(input.id).success || !z.email().safeParse(input.email).success || /[\r\n]/.test(input.email)) return "FAILED";
  const message = notificationEmail(input.origin, input.href, input.payload), transport = createVerificationTransport();
  try {
    const result = await transport.sendMail({ from: { name: "Metro", address: "metro.service.net@gmail.com" }, to: input.email, messageId: `<metro-notification-${input.id}@metro.service.net>`, ...message });
    return result.accepted?.includes(input.email) && !result.rejected?.length ? "SENT" : "FAILED";
  } catch (error) { return deliveryFailure(error); } finally { transport.close(); }
}
