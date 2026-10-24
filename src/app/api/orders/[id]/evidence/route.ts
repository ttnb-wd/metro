import { z } from "zod";
import { POST as submitCheckout } from "../../../checkout/submit/route";
import { limitedBody, commerceFailure } from "@/server/commerce/http";
import { FoundationError } from "@/server/owner/authorization";
import { MAX_PAYMENT_PROOF_BYTES } from "@/features/commerce/evidence-policy";

export const runtime = "nodejs";
export const maxDuration = 60;
/** Compatibility entry point, using the same authorization and transaction.
 * Corrections require explicit prior OWNER rejection, never UNDER_REVIEW. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new FoundationError("NOT_FOUND");
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;")) throw new FoundationError("INVALID_REQUEST");
    const body = await limitedBody(request, MAX_PAYMENT_PROOF_BYTES + 8192);
    const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": type } }).formData();
    if ([...form.keys()].some(key => !["requestKey", "proof"].includes(key)) || ["requestKey", "proof"].some(key => form.getAll(key).length !== 1)) throw new FoundationError("INVALID_REQUEST");
    form.set("orderId", id);
    const headers = new Headers(request.headers); headers.delete("content-type"); headers.delete("content-length");
    const response = await submitCheckout(new Request(request.url, { method: "POST", headers, body: form, signal: request.signal }));
    if (!response.ok) return response;
    const result = await response.json();
    return Response.json({ id: result.evidenceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return commerceFailure(error); }
}
