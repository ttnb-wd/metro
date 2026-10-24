import "server-only";
import { z } from "zod";
import { createVerificationTransport } from "./verification";

export const RESET_LIFETIME_SECONDS = 15 * 60;
export const resetTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24,256}$/);

export function passwordResetMessage(origin: string, token: string) {
  const base = new URL(origin);
  if (base.origin !== origin || !["http:", "https:"].includes(base.protocol)) throw new Error("Invalid reset destination.");
  const destination = new URL("/reset-password", base);
  destination.hash = new URLSearchParams({ token: resetTokenSchema.parse(token) }).toString();
  const link = destination.href;
  const safeLink = link.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return {
    subject: "Reset your Metro password",
    text: `METRO\n\nReset your password:\n${link}\n\nThis link expires in 15 minutes and can be used once. Your existing sessions will be signed out after a successful reset. If you did not request this, ignore this email.\n\nMetro`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;padding:32px 20px;background:#eef4fa;color:#10243d;font-family:Arial,sans-serif"><main style="max-width:520px;margin:auto;padding:32px;background:#fff;border-radius:16px"><p style="font-weight:700;letter-spacing:3px;color:#075cb5">METRO</p><h1>Reset your password</h1><p>Choose a new password for your Metro account.</p><p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;padding:16px 24px;background:#075cb5;color:#fff;border-radius:8px;text-decoration:none">Reset password</a></p><p>This link expires in 15 minutes and can be used once. After a successful reset, your existing sessions will be signed out.</p><p>If you did not request this, ignore this email.</p><p style="font-size:12px;overflow-wrap:anywhere">Button not working? Open:<br><a href="${safeLink}">${safeLink}</a></p></main></body></html>`,
  };
}

export async function sendPasswordResetEmail(input: { email: string; token: string; origin: string }) {
  if (!z.email().safeParse(input.email).success || /[\r\n]/.test(input.email)) throw new Error("Invalid reset recipient.");
  const message = passwordResetMessage(input.origin, input.token), transport = createVerificationTransport();
  try {
    const result = await transport.sendMail({ from: { name: "Metro", address: "metro.service.net@gmail.com" }, to: input.email, ...message });
    if (!result.accepted?.includes(input.email) || result.rejected?.length) throw new Error();
  } catch { throw new Error("Metro password recovery email is temporarily unavailable."); }
  finally { transport.close(); }
}
