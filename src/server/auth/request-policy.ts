import "server-only";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import type { EnabledAuthEnvironment } from "@/server/env";
import { isSafeAuthCallback } from "@/server/auth/redirects";
import { INTERNAL_AUTH_IP_HEADER } from "@/server/auth/options";

export const MAX_AUTH_BODY_BYTES = 16 * 1024;
const callbackFields = ["callbackURL", "errorCallbackURL", "newUserCallbackURL", "redirectTo"];

export class AuthRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super("Invalid authentication request.");
    this.name = "AuthRequestError";
  }
}

function validateCallbacks(values: Record<string, unknown>, origin: string) {
  for (const key of callbackFields) {
    if (values[key] !== undefined && !isSafeAuthCallback(values[key], origin)) {
      throw new AuthRequestError(400, "INVALID_CALLBACK");
    }
  }
}

async function readBoundedJson(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_AUTH_BODY_BYTES)) {
    throw new AuthRequestError(413, "REQUEST_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthRequestError(400, "INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_AUTH_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new AuthRequestError(413, "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AuthRequestError(400, "INVALID_BODY"); }
}

export async function prepareAuthRequest(request: Request, environment: EnabledAuthEnvironment): Promise<Request> {
  const url = new URL(request.url);
  const configured = new URL(environment.origin);
  if (url.origin !== configured.origin) {
    // NextURL normalizes loopback IPs to localhost. Permit only this precise
    // development normalization, with the actual Host still matching the
    // fixed configured origin. Never trust forwarded hosts or arbitrary URLs.
    const normalizedLoopback = environment.nodeEnv !== "production" && ["127.0.0.1", "[::1]"].includes(configured.hostname)
      && url.hostname === "localhost" && url.protocol === configured.protocol && url.port === configured.port
      && request.headers.get("host") === configured.host;
    if (!normalizedLoopback) throw new AuthRequestError(403, "UNTRUSTED_ORIGIN");
    url.host = configured.host;
  }
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== environment.origin) || (request.method === "POST" && origin !== environment.origin)) {
    throw new AuthRequestError(403, "UNTRUSTED_ORIGIN");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AuthRequestError(403, "UNTRUSTED_ORIGIN");
  for (const field of callbackFields) {
    for (const value of url.searchParams.getAll(field)) {
      if (!isSafeAuthCallback(value, environment.origin)) throw new AuthRequestError(400, "INVALID_CALLBACK");
    }
  }
  let body: string | undefined;
  let account: string | undefined;
  if (request.method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new AuthRequestError(415, "JSON_REQUIRED");
    }
    body = await readBoundedJson(request);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new AuthRequestError(400, "INVALID_BODY"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AuthRequestError(400, "INVALID_BODY");
    validateCallbacks(parsed as Record<string, unknown>, environment.origin);
    const email = (parsed as Record<string, unknown>).email;
    const token = (parsed as Record<string, unknown>).token;
    if (typeof email === "string") account = `email:${email.trim().toLowerCase()}`;
    else if (typeof token === "string") account = `verification:${token}`;
  }
  const headers = new Headers(request.headers);
  // Vercel overwrites x-real-ip at its ingress. An environment flag describing
  // the actual hosting platform is required; client headers cannot enable it.
  // Other production hosts need their own reviewed ingress adapter, not a
  // configurable arbitrary forwarded header or a shared loopback fallback.
  const trustedIp = environment.platform === "vercel" ? headers.get("x-real-ip")?.trim() : undefined;
  if (environment.nodeEnv === "production" && (!trustedIp || !isIP(trustedIp))) {
    throw new AuthRequestError(503, "AUTH_SOURCE_UNAVAILABLE");
  }
  // Verification links have independent opaque token budgets; invalid links
  // cannot consume another customer's valid-link budget. The separate trusted
  // production source budget also limits attacks that rotate random tokens.
  const cookie = headers.get("cookie");
  const identity = account ?? (cookie ? `session:${cookie}` : `anonymous-source:${trustedIp ?? "development"}`);
  // Account scope prevents unrelated users (including users behind a NAT) from
  // sharing a login/verification bucket. It also cannot be rotated with spoofed
  // IP headers. Missing development IP information never becomes a global
  // authentication bucket. The synthetic address contains no personal data.
  const digest = createHmac("sha256", environment.secret).update(identity).digest("hex").slice(0, 32);
  for (const key of ["x-forwarded-for", "x-vercel-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", "x-metro-auth-source", INTERNAL_AUTH_IP_HEADER]) headers.delete(key);
  if (trustedIp && isIP(trustedIp)) headers.set("x-metro-auth-source", createHmac("sha256", environment.secret).update(`source:${trustedIp}`).digest("hex"));
  headers.set(INTERNAL_AUTH_IP_HEADER, digest.match(/.{4}/g)!.join(":"));
  return new Request(url.href, { method: request.method, headers, body, signal: request.signal });
}
