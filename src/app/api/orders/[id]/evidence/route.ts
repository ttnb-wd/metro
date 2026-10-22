import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commerceRequest, commerceFailure, limitedBody } from "@/server/commerce/http";
import { evidenceStore } from "@/server/commerce/evidence-store";
import { getWebsiteRepositories } from "@/server/website";
import { FoundationError } from "@/server/owner/authorization";
import { revalidatePath } from "next/cache";
import { MAX_PAYMENT_PROOF_BYTES } from "@/features/commerce/evidence-policy";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let stored: string | undefined, orderId: string | undefined;
  let repository: Awaited<ReturnType<typeof getWebsiteRepositories>> | undefined;
  try {
    await commerceRequest(request, true, "upload");
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new FoundationError("INVALID_REQUEST");
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new FoundationError("NOT_FOUND");
    orderId = id;
    repository = await getWebsiteRepositories(); await repository.order(id);
    const raw = await limitedBody(request, MAX_PAYMENT_PROOF_BYTES + 8192);
    const form = await new Response(new Uint8Array(raw), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("proof"), requestKey = form.get("requestKey");
    if ([...form.keys()].some(key => !["requestKey", "proof"].includes(key)) || ["requestKey", "proof"].some(key => form.getAll(key).length !== 1)
      || !(file instanceof File) || !file.size || file.size > MAX_PAYMENT_PROOF_BYTES || !z.uuid().safeParse(requestKey).success || !["image/png", "image/jpeg"].includes(file.type)) throw new FoundationError("INVALID_REQUEST");
    const receipt = await evidenceStore().put(Buffer.from(await file.arrayBuffer()), file.type); stored = receipt.storageRef;
    const prior = await repository.evidenceReplay(id, String(requestKey));
    if (prior) {
      await evidenceStore().remove(stored); stored = undefined;
      if (prior.sha256 !== receipt.sha256) throw new FoundationError("CONFLICT");
      return Response.json({ id: prior.id }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await repository.addEvidence({ orderId: id, ...receipt }, { requestId: randomUUID(), idempotencyKey: String(requestKey) });
    revalidatePath("/dashboard", "layout"); revalidatePath("/admin", "layout");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // A lost commit response is ambiguous. Retain encrypted files for recovery
    // rather than deleting proof that may already be referenced by an order.
    if (stored && orderId && repository) {
      try { if (await repository.evidenceIsUnreferenced(orderId, stored)) await evidenceStore().remove(stored); }
      catch { /* Keep evidence whenever the committed state cannot be verified. */ }
    }
    return commerceFailure(error);
  }
}
