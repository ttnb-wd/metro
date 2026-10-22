import "server-only";
import { z } from "zod";
import { serviceConfigured } from "../vpn/transport";
import { websiteKbzPay } from "@/config/payments";

export const paymentMethodSchema = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), name: z.string().trim().min(1).max(80), accountName: z.string().trim().min(1).max(100), accountNumber: z.string().trim().min(3).max(60) });
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
// Explicit website-only business configuration; no VPN/bot recipient lookup.
const businessMethods: PaymentMethod[] = [{ ...websiteKbzPay }];
export function paymentMethods(source = process.env): PaymentMethod[] {
  try {
    const data: unknown = source.METRO_PAYMENT_METHODS_JSON ? JSON.parse(source.METRO_PAYMENT_METHODS_JSON) : businessMethods;
    return z.array(paymentMethodSchema).max(10).parse(data).filter(method => !/YOUR_|REPLACE|EXAMPLE/i.test(`${method.accountName} ${method.accountNumber}`));
  } catch { return []; }
}
export function fulfilmentEnabled(source = process.env) { return source.METRO_FULFILMENT_ENABLED === "true" && source.METRO_VPN_EXECUTION_APPROVED === "true"; }

export function commerceEnabled() { return fulfilmentEnabled() && serviceConfigured(); }
