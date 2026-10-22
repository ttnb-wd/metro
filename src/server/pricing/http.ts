import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { PrismaClient } from "../db/generated/client";
import type { EnabledAuthEnvironment } from "../env";

export async function readQuoteBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 1024) { await reader.cancel(); throw new Error("INVALID_REQUEST"); }
    chunks.push(chunk.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("INVALID_REQUEST"); }
}

// Shared durable limiter unless an explicitly trusted proxy supplies a valid IP.
export async function allowQuoteRequest(db: PrismaClient, request: Request, env: EnabledAuthEnvironment) {
  const claimed = env.trustedIpHeader ? request.headers.get(env.trustedIpHeader) : null;
  const identity = claimed && isIP(claimed) ? claimed : "shared";
  const key = `website-quote:${createHash("sha256").update(identity).digest("hex")}`;
  const [result] = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO metro_rate_limit (id,key,count,"lastRequest")
    VALUES (${randomUUID()},${key},1,(extract(epoch FROM clock_timestamp())*1000)::bigint)
    ON CONFLICT (key) DO UPDATE SET
      count=CASE WHEN metro_rate_limit."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-60000 THEN 1 ELSE LEAST(metro_rate_limit.count+1,601) END,
      "lastRequest"=CASE WHEN metro_rate_limit."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-60000 THEN (extract(epoch FROM clock_timestamp())*1000)::bigint ELSE metro_rate_limit."lastRequest" END
    RETURNING count`;
  return result.count <= (identity === "shared" ? 600 : 120);
}
