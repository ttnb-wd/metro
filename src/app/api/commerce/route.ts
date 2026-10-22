import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getWebsiteRepositories } from "@/server/website";
import { getPublicPricing } from "@/server/pricing";
import { readServerEnvironment } from "@/server/env";
import { commerceFailure, commerceRequest, limitedBody } from "@/server/commerce/http";
import { paymentMethods } from "@/server/commerce/config";
import { evidenceStorageReady } from "@/server/commerce/evidence-store";
import { signCheckoutQuote } from "@/server/commerce/quote";
import { FoundationError } from "@/server/owner/authorization";
import { revalidatePath } from "next/cache";

const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("quote"), packageId: z.uuid(), version: z.number().int().positive(), months: z.number().int().min(1).max(12), paymentMethodId: z.string().max(40) }),
  z.strictObject({ action: z.literal("issue"), serviceId: z.uuid(), description: z.string().trim().min(1).max(1000), requestKey: z.uuid() }),
  z.strictObject({ action: z.literal("retry"), issueId: z.uuid(), version: z.number().int().nonnegative(), expectedAttempt: z.number().int().min(0).max(2), result: z.enum(["SUCCEEDED", "FAILED"]), requestKey: z.uuid() }),
]);
export async function POST(request: Request) {
  try {
    const { session } = await commerceRequest(request);
    const parsed = requestSchema.safeParse(JSON.parse((await limitedBody(request, 6500)).toString("utf8")));
    if (!parsed.success) throw new FoundationError("INVALID_REQUEST");
    const data = parsed.data, env = readServerEnvironment(); if (!env.enabled) throw new FoundationError("DISABLED");
    let result: object;
    if (data.action === "quote") {
      const pricing = await getPublicPricing(), method = paymentMethods().find(method => method.id === data.paymentMethodId);
      if (pricing.status !== "READY" || !method || !evidenceStorageReady()) throw new FoundationError("UNAVAILABLE");
      result = signCheckoutQuote(pricing.release, { packageId: data.packageId, version: data.version, months: data.months }, session.user.id, method, env.secret);
    } else {
      const repository = await getWebsiteRepositories(), metadata = { requestId: randomUUID(), idempotencyKey: data.requestKey };
      if (data.action === "issue") result = await repository.reportIssue({ serviceId: data.serviceId, category: "CANNOT_CONNECT", description: data.description }, metadata);
      else result = await repository.recordRetry({ issueId: data.issueId, version: data.version, expectedAttempt: data.expectedAttempt, result: data.result }, metadata);
      revalidatePath("/dashboard", "layout"); revalidatePath("/admin", "layout");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return commerceFailure(error); }
}
