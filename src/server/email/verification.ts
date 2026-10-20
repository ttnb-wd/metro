import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";

export const VERIFICATION_LIFETIME_SECONDS = 60 * 60;

export function readSmtpEnvironment(source: Record<string, string | undefined> = process.env) {
  const result = z.object({
    SMTP_USER: z.literal("metro.service.net@gmail.com"),
    SMTP_APP_PASSWORD: z.string().transform(value => value.replace(/\s/g, "")).pipe(z.string().regex(/^[a-zA-Z]{16}$/)),
  }).safeParse(source);
  if (!result.success) throw new Error("Metro email configuration is unavailable.");
  return { user: result.data.SMTP_USER, password: result.data.SMTP_APP_PASSWORD };
}

export function createVerificationTransport() {
  const smtp = readSmtpEnvironment();
  return nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: true, servername: "smtp.gmail.com", minVersion: "TLSv1.2" },
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function verificationMessage(origin: string, betterAuthUrl: string) {
  const source = new URL(betterAuthUrl);
  if (source.origin !== origin || source.pathname !== "/api/auth/verify-email"
    || source.username || source.password || source.hash || source.searchParams.getAll("token").length !== 1) {
    throw new Error("Invalid Metro email verification request.");
  }
  const token = source.searchParams.get("token");
  if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid Metro email verification request.");
  }
  // Fragments never reach HTTP access logs or Referer headers. The browser
  // removes the fragment before POSTing the token to the official auth flow.
  const destination = new URL("/verify-email", origin);
  destination.hash = new URLSearchParams({ token }).toString();
  const link = destination.href;
  const safeLink = escapeHtml(link);
  return {
    subject: "Verify your Metro email address",
    text: `METRO\nYour digital essentials. One place.\n\nVerify your email address to sign in to Metro:\n${link}\n\nThis link expires in 60 minutes. If you did not request this email, you can ignore it.\nVerification does not purchase or activate a service.\n\nMetro`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef4fa;font-family:Arial,sans-serif;color:#10243d"><table role="presentation" style="width:100%;border-spacing:0"><tr><td style="padding:40px 20px"><table role="presentation" style="width:100%;max-width:540px;margin:auto;border-spacing:0;background:#fff;border-radius:16px"><tr><td style="padding:36px"><p style="font-size:18px;font-weight:700;letter-spacing:3px;color:#075cb5">METRO</p><h1 style="font-size:28px;line-height:1.2">Your account. Your essentials.</h1><p style="font-size:16px;line-height:1.7">Confirm your email address to sign in and manage your digital services with Metro.</p><p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;padding:16px 24px;border-radius:8px;background:#075cb5;color:#fff;font-weight:700;text-decoration:none">Verify email address</a></p><p style="font-size:14px;line-height:1.7;color:#4a6077">This link expires in 60 minutes. If you did not request this email, you can ignore it.</p><p style="font-size:12px;line-height:1.7;color:#4a6077">Button not working? Copy this link into your browser:<br><a href="${safeLink}" style="color:#075cb5;word-break:break-all">${safeLink}</a></p><hr style="border:0;border-top:1px solid #dce5ee;margin:28px 0"><p style="font-size:12px;line-height:1.7;color:#4a6077">Your digital essentials. One place.<br>Verification does not purchase or activate a service.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendVerificationEmail(input: { email: string; url: string; origin: string }): Promise<void> {
  if (!z.email().safeParse(input.email).success || /[\r\n]/.test(input.email)) throw new Error("Invalid Metro email recipient.");
  const message = verificationMessage(input.origin, input.url);
  const transport = createVerificationTransport();
  try {
    const result = await transport.sendMail({
      from: { name: "Metro", address: "metro.service.net@gmail.com" },
      to: input.email, ...message,
    });
    if (!result.accepted?.includes(input.email) || result.rejected?.length) throw new Error();
  } catch {
    // Never propagate SMTP responses: they can include recipient or auth data.
    throw new Error("Metro verification email delivery is temporarily unavailable.");
  } finally { transport.close(); }
}
