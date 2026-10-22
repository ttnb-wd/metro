import { randomUUID } from "node:crypto";
import { assertAdminOrigin } from "@/server/admin/request";
import { readServerEnvironment } from "@/server/env";
import { FoundationError } from "@/server/owner/authorization";
import { foundationDatabase } from "@/server/website";
import { allowQuoteRequest, readQuoteBody } from "@/server/pricing/http";
import { getServerQuote } from "@/server/pricing";
import { quoteSelectionSchema } from "@/features/pricing/catalog";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = randomUUID();
  const reply = (body: object, status = 200) => Response.json({ requestId, ...body }, { status, headers: { "Cache-Control": "no-store", "Vary": "Origin", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  try {
    assertAdminOrigin(request.headers);
    const selection = quoteSelectionSchema.safeParse(await readQuoteBody(request));
    if (!selection.success) return reply({ code: "INVALID_REQUEST", message: "Choose a valid package and duration." }, 400);
    const env = readServerEnvironment();
    if (!env.enabled) return reply({ code: "UNAVAILABLE", message: "Website pricing is unavailable." }, 503);
    if (!await allowQuoteRequest(await foundationDatabase(), request, env)) return reply({ code: "RATE_LIMITED", message: "Please wait a minute before requesting another quote." }, 429);
    const quote = await getServerQuote(selection.data);
    return reply({ quote });
  } catch (error) {
    if (error instanceof FoundationError && error.code === "FORBIDDEN") return reply({ code: "FORBIDDEN", message: "Request origin is not permitted." }, 403);
    const code = error instanceof Error ? error.message : "";
    if (code === "PRICING_CHANGED") return reply({ code, message: "Website prices changed. Refresh to review the latest version." }, 409);
    if (code === "PLAN_UNAVAILABLE") return reply({ code, message: "This package or duration is no longer available." }, 409);
    if (code === "INVALID_REQUEST") return reply({ code, message: "Choose a valid package and duration." }, 400);
    return reply({ code: "UNAVAILABLE", message: "Website pricing is temporarily unavailable. Please try again." }, 503);
  }
}
