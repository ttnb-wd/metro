import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { calculateWebsiteQuote, type PricingRelease } from "@/features/pricing/catalog";
import { FoundationError } from "../owner/authorization";
import { paymentMethodSchema, type PaymentMethod } from "./config";

const envelope = z.strictObject({ id: z.uuid(), userId: z.uuid(), packageId: z.uuid(), months: z.number().int().min(1).max(12), version: z.number().int().positive(), expiresAt: z.number().int().positive(), paymentMethod: paymentMethodSchema });
export type QuoteEnvelope = z.infer<typeof envelope>;
// Read only from an owned immutable order snapshot, never from a browser body.
export const checkoutInvoiceSchema = z.object({
  packageName: z.string().min(1).max(80), durationDays: z.number().int().positive(), totalDataGb: z.number().int().positive(),
  regularMmk: z.string().regex(/^[0-9]+$/), savedMmk: z.string().regex(/^[0-9]+$/), totalMmk: z.string().regex(/^[0-9]+$/),
  discountPercent: z.number().int().min(0).max(100), paymentMethod: paymentMethodSchema,
});
function signature(body: string, secret: string) { return createHmac("sha256", secret).update(`metro-checkout.v1:${body}`).digest(); }
export function signCheckoutQuote(release: PricingRelease, selection: unknown, userId: string, method: PaymentMethod, secret: string, now = Date.now()) {
  const quote = calculateWebsiteQuote(release, selection);
  const input = envelope.parse({ id: randomUUID(), userId, packageId: quote.packageId, months: quote.months, version: quote.pricingVersion, expiresAt: now + 600_000, paymentMethod: method });
  const body = Buffer.from(JSON.stringify(input)).toString("base64url");
  return { quote, token: `${body}.${signature(body, secret).toString("base64url")}` };
}
export function verifyCheckoutQuote(token: unknown, userId: string, secret: string, now = Date.now()): QuoteEnvelope {
  try {
    if (typeof token !== "string" || token.length > 4000) throw new Error();
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra) throw new Error();
    const expected = signature(body, secret), actual = Buffer.from(mac, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const data = envelope.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (data.userId !== userId || now >= data.expiresAt || data.expiresAt > now + 600_000) throw new Error();
    return data;
  } catch { throw new FoundationError("INVALID_REQUEST"); }
}
