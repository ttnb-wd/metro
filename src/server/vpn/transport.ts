import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import https from "node:https";
import { z } from "zod";
import { FoundationError } from "../owner/authorization";
export const SERVICE_VERSION = "metro-commerce.v1" as const;
export type ServiceAction = "capabilities" | "catalog" | "entitlement" | "credential" | "fulfil" | "replace";
export function serviceSignature(secret: string, timestamp: string, nonce: string, body: string) {
  return createHmac("sha256", secret).update(`POST\n/metro/v1/execute\n${timestamp}\n${nonce}\n${createHash("sha256").update(body).digest("hex")}`).digest("hex");
}
export function serviceConfigured(source = process.env) {
  try { serviceConfiguration(source); return true; } catch { return false; }
}
function serviceConfiguration(source = process.env) {
  const origin = new URL(source.METRO_VPN_SERVICE_ORIGIN ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !/^[a-f0-9]{64,128}$/i.test(source.METRO_VPN_SERVICE_SECRET ?? "") || new Set(source.METRO_VPN_SERVICE_SECRET!.toLowerCase()).size < 10 || !/^[a-z0-9_-]{1,40}$/.test(source.METRO_VPN_SERVICE_KEY_ID ?? "")) throw new FoundationError("UNAVAILABLE");
  return { origin, secret: source.METRO_VPN_SERVICE_SECRET!, keyId: source.METRO_VPN_SERVICE_KEY_ID! };
}
export async function callVpnService(action: ServiceAction, input: object, source = process.env): Promise<unknown> {
  const config = serviceConfiguration(source), timestamp = Date.now().toString(), nonce = randomUUID(), requestId = randomUUID();
  const body = JSON.stringify({ version: SERVICE_VERSION, action, requestId, ...input });
  if (Buffer.byteLength(body) > 32768) throw new FoundationError("INVALID_REQUEST");
  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      const request = https.request(new URL("/metro/v1/execute", config.origin), { method: "POST", rejectUnauthorized: true, servername: config.origin.hostname, timeout: 15000, headers: {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-Metro-Key": config.keyId, "X-Metro-Time": timestamp, "X-Metro-Nonce": nonce, "X-Metro-Signature": serviceSignature(config.secret, timestamp, nonce, body),
      } }, response => {
        let size = 0; const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) { response.destroy(); reject(new Error()); } else chunks.push(chunk); });
        response.on("error", reject);
        response.on("end", () => { try { if (response.statusCode !== 200) throw new Error(); const result = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (result.requestId !== requestId || result.version !== SERVICE_VERSION) throw new Error(); resolve(result.data); } catch { reject(new Error()); } });
      });
      request.on("timeout", () => request.destroy(new Error())); request.on("error", reject); request.end(body);
    });
    return response;
  } catch { throw new FoundationError("UNAVAILABLE"); }
}
export const nativeCredentialSchema = z.strictObject({ owner: z.strictObject({ issuer: z.literal("metro-website"), subject: z.uuid() }), entitlementId: z.uuid(), version: z.number().int().nonnegative(), keyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), credential: z.string().regex(/^ss:\/\/\S+$/).max(4096) });
