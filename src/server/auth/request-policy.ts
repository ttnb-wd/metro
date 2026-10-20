import "server-only";
import { isIP } from "node:net";
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
  if (request.method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new AuthRequestError(415, "JSON_REQUIRED");
    }
    body = await readBoundedJson(request);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new AuthRequestError(400, "INVALID_BODY"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AuthRequestError(400, "INVALID_BODY");
    validateCallbacks(parsed as Record<string, unknown>, environment.origin);
  }
  const headers = new Headers(request.headers);
  const trustedIp = environment.trustedIpHeader ? headers.get(environment.trustedIpHeader)?.trim() : undefined;
  for (const key of ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", INTERNAL_AUTH_IP_HEADER]) headers.delete(key);
  headers.set(INTERNAL_AUTH_IP_HEADER, trustedIp && isIP(trustedIp) ? trustedIp : "127.0.0.1");
  return new Request(url.href, { method: request.method, headers, body, signal: request.signal });
}
