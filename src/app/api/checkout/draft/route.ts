import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getWebsiteRepositories } from "@/server/website";
import { readServerEnvironment } from "@/server/env";
import { commerceRequest, commerceFailure, limitedBody } from "@/server/commerce/http";
import { paymentMethods, commerceEnabled } from "@/server/commerce/config";
import { evidenceStorageReady } from "@/server/commerce/evidence-store";
import { verifyCheckoutQuote } from "@/server/commerce/quote";
import { FoundationError } from "@/server/owner/authorization";

export async function POST(request: Request) {
  try {
    const { session } = await commerceRequest(request);
    const env = readServerEnvironment();
    if (!env.enabled || !commerceEnabled() || !evidenceStorageReady()) throw new FoundationError("UNAVAILABLE");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new FoundationError("INVALID_REQUEST");
    const input = z.strictObject({ token: z.string().min(1).max(4000), requestKey: z.uuid() }).safeParse(JSON.parse((await limitedBody(request, 6000)).toString("utf8")));
    if (!input.success) throw new FoundationError("INVALID_REQUEST");
    const quote = verifyCheckoutQuote(input.data.token, session.user.id, env.secret);
    if (!paymentMethods().some(method => JSON.stringify(method) === JSON.stringify(quote.paymentMethod))) throw new FoundationError("CONFLICT");
    const repository = await getWebsiteRepositories();
    const result = await repository.createWebsiteOrder(quote, { requestId: randomUUID(), idempotencyKey: input.data.requestKey });
    const order = await repository.order(result.id);
    // UNVERIFIED is a draft, never an OWNER review request. Only evidence
    // submission may move it to UNDER_REVIEW and notify the OWNER.
    return Response.json({ id: order.id, totalMmk: order.totalMmk.toFixed(0), payment: order.payment, ready: order.state === "AWAITING_PAYMENT" && order.payment === "UNVERIFIED", submitted: order.payment !== "UNVERIFIED" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return commerceFailure(error); }
}
