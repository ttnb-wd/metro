import "server-only";
import { randomUUID } from "node:crypto";
import { FoundationError } from "../owner/authorization";
import { foundationDatabase } from "../website";
import { getWebsiteSession } from "../auth/session";
import { assertAdminOrigin } from "../admin/request";

export async function commerceRequest(request: Request, mutation = true, bucket: "standard" | "upload" = "standard") {
  if (mutation) assertAdminOrigin(request.headers);
  const session = await getWebsiteSession();
  if (!session?.user.emailVerified) throw new FoundationError("UNAUTHENTICATED");
  const db = await foundationDatabase();
  if (mutation) {
    const key = `commerce:${bucket}:${session.user.id}`;
    const [limit] = await db.$queryRaw<Array<{ count: number }>>`INSERT INTO metro_rate_limit (id,key,count,"lastRequest")
      VALUES (${randomUUID()},${key},1,(extract(epoch FROM clock_timestamp())*1000)::bigint)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN metro_rate_limit."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-60000 THEN 1 ELSE LEAST(metro_rate_limit.count+1,61) END,
      "lastRequest"=CASE WHEN metro_rate_limit."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-60000 THEN (extract(epoch FROM clock_timestamp())*1000)::bigint ELSE metro_rate_limit."lastRequest" END RETURNING count`;
    if (limit.count > (bucket === "upload" ? 6 : 60)) throw new FoundationError("CONFLICT");
  }
  return { session, db };
}
export async function limitedBody(request: Request, maximum: number) {
  const reader = request.body?.getReader(); if (!reader) throw new FoundationError("INVALID_REQUEST");
  const parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) throw new FoundationError("INVALID_REQUEST"); parts.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
export function commerceFailure(error: unknown) {
  const code = error instanceof FoundationError ? error.code : "UNAVAILABLE";
  const status = ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_REQUEST: 400, RECENT_AUTH_REQUIRED: 403, DISABLED: 503, UNAVAILABLE: 503 })[code];
  const message = code === "RECENT_AUTH_REQUIRED" ? "Sign out and sign in again, then retry within five minutes." : code === "CONFLICT" ? "This request changed, expired or was rate limited. Refresh and try again." : code === "INVALID_REQUEST" ? "Check the request details and try again." : code === "UNAUTHENTICATED" ? "Please sign in to your verified account." : code === "FORBIDDEN" ? "Open Metro at its configured website address, reload this page and try again." : "This operation is unavailable. Please try again when the service is ready.";
  return Response.json({ code, message, requestId: randomUUID() }, { status, headers: { "Cache-Control": "no-store" } });
}
