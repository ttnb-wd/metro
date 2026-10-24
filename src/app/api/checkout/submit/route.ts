import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWebsiteRepositories } from "@/server/website";
import { readServerEnvironment } from "@/server/env";
import { commerceRequest, commerceFailure, limitedBody } from "@/server/commerce/http";
import { commerceEnabled } from "@/server/commerce/config";
import { evidenceStore, normalizeEvidence } from "@/server/commerce/evidence-store";
import { FoundationError } from "@/server/owner/authorization";
import { MAX_PAYMENT_PROOF_BYTES } from "@/features/commerce/evidence-policy";

export const runtime = "nodejs";
export const maxDuration = 60;
const fields = z.strictObject({ orderId: z.uuid(), requestKey: z.uuid() });

export async function POST(request: Request) {
  let stored: string | undefined;
  let repository: Awaited<ReturnType<typeof getWebsiteRepositories>> | undefined, orderId: string | undefined;
  try {
    await commerceRequest(request, true, "upload");
    const env = readServerEnvironment();
    if (!env.enabled || !commerceEnabled()) throw new FoundationError("UNAVAILABLE");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;")) throw new FoundationError("INVALID_REQUEST");
    const body = await limitedBody(request, MAX_PAYMENT_PROOF_BYTES + 16384);
    const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData();
    if ([...form.keys()].some(key => !["orderId", "requestKey", "proof"].includes(key))
      || ["orderId", "requestKey", "proof"].some(key => form.getAll(key).length !== 1)) throw new FoundationError("INVALID_REQUEST");
    const input = fields.safeParse({ orderId: form.get("orderId"), requestKey: form.get("requestKey") }), file = form.get("proof");
    if (!input.success || !(file instanceof File) || !file.size || file.size > MAX_PAYMENT_PROOF_BYTES || !["image/png", "image/jpeg"].includes(file.type)) throw new FoundationError("INVALID_REQUEST");
    orderId = input.data.orderId;
    repository = await getWebsiteRepositories(); const order = await repository.order(orderId);
    const normalized = await normalizeEvidence(Buffer.from(await file.arrayBuffer()), file.type);
    const previous = await repository.checkoutReceipt(orderId);
    if (previous && order.payment !== "REJECTED") {
      if (previous.sha256 !== createHash("sha256").update(normalized).digest("hex")) throw new FoundationError("CONFLICT");
      return Response.json({ id: orderId, evidenceId: previous.id, payment: previous.payment, submitted: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const uploadId = await repository.reserveEvidenceUpload(orderId);
    // Private storage is verified durable before the payment becomes reviewable.
    const receipt = await evidenceStore().put(normalized, "image/png", uploadId); stored = receipt.storageRef;
    const result = await repository.submitDraftPayment(orderId, receipt, { requestId: randomUUID(), idempotencyKey: input.data.requestKey });
    const accepted = await repository.checkoutReceipt(orderId);
    if (!accepted || accepted.orderId !== result.id || accepted.sha256 !== receipt.sha256) throw new FoundationError("UNAVAILABLE");
    if (accepted.storageRef !== stored) { await evidenceStore().remove(stored); stored = undefined; }
    revalidatePath("/dashboard", "layout"); revalidatePath("/admin", "layout");
    return Response.json({ id: result.id, evidenceId: accepted.id, payment: accepted.payment, submitted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Reconcile under the order lock after rollback or an ambiguous reply.
    // Never delete submitted evidence; retain it if recovery cannot be verified.
    if (stored && orderId && repository) {
      try {
        if (await repository.evidenceIsUnreferenced(orderId, stored)) await evidenceStore().remove(stored);
      } catch { /* Retain encrypted evidence when database recovery is uncertain. */ }
    }
    return commerceFailure(error);
  }
}
