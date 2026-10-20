import "server-only";
import { z } from "zod";

export const API_VERSION = "metro-vpn.v1" as const;
export const WEBSITE_ISSUER = "metro-website" as const;
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const integer = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const positiveInteger = integer.refine(value => BigInt(value) > BigInt(0));
export const instant = z.iso.datetime();
export const ownerSchema = z.strictObject({ issuer: z.literal(WEBSITE_ISSUER), subject: id });
export type Owner = z.infer<typeof ownerSchema>;
export const metadataSchema = z.strictObject({ requestId: z.uuid(), idempotencyKey: z.uuid().optional() });

export const orderStates = ["AWAITING_PAYMENT", "FULFILMENT_PENDING", "COMPLETE", "CANCELLED", "REVIEW_REQUIRED"] as const;
export const paymentStates = ["UNVERIFIED", "UNDER_REVIEW", "CONFIRMED", "REJECTED", "REFUND_REVIEW", "REFUNDED"] as const;
export const provisioningStates = ["NOT_REQUESTED", "QUEUED", "PROCESSING", "RETRY_PENDING", "SUCCEEDED", "REVIEW_REQUIRED"] as const;
export const issueStates = ["OPEN", "DIAGNOSING", "TROUBLESHOOTING", "REPLACEMENT_APPROVED", "REVIEW_REQUIRED", "RESOLVED", "CLOSED"] as const;
export const replacementStates = ["REQUESTED", "FAILURE_VERIFIED", "NEW_KEY_BLOCKED", "LIMIT_VERIFIED", "OLD_KEY_DISABLED", "COMMITTED", "COMPLETED", "REVIEW_REQUIRED"] as const;

export const packageSchema = z.strictObject({
  id, name: z.string().min(1).max(100), monthlyPriceMmk: positiveInteger,
  monthlyQuotaBytes: positiveInteger, baseDurationDays: z.literal(30),
});
export const quoteSchema = z.strictObject({
  id, owner: ownerSchema, packageId: id, catalogVersion: id, pricingPolicy: z.literal("website-30d-v1"),
  months: z.number().int().min(1).max(12), durationDays: z.number().int().min(30).max(360),
  monthlyPriceMmk: positiveInteger, monthlyQuotaBytes: positiveInteger,
  regularMmk: positiveInteger, discountPercent: z.number().int().min(0).max(55),
  savedMmk: integer, totalMmk: positiveInteger, quotaBytes: positiveInteger, validUntil: instant,
}).superRefine((q, ctx) => {
  const regular = BigInt(q.monthlyPriceMmk) * BigInt(q.months);
  const discount = (q.months - 1) * 5;
  const saved = (regular * BigInt(discount) + BigInt(50)) / BigInt(100);
  if (q.durationDays !== q.months * 30 || q.discountPercent !== discount ||
      BigInt(q.regularMmk) !== regular || BigInt(q.savedMmk) !== saved ||
      BigInt(q.totalMmk) !== regular - saved ||
      BigInt(q.quotaBytes) !== BigInt(q.monthlyQuotaBytes) * BigInt(q.months)) {
    ctx.addIssue({ code: "custom", message: "Inconsistent quote." });
  }
});
export type Quote = z.infer<typeof quoteSchema>;

export const entitlementSchema = z.strictObject({
  id, owner: ownerSchema, packageId: id, version: z.number().int().nonnegative(),
  status: z.enum(["ACTIVE", "EXPIRED", "QUOTA_EXHAUSTED", "REVOKED", "PENDING"]),
  keyId: id.nullable(), keyStatus: z.enum(["UNAVAILABLE", "BLOCKED", "ENFORCED", "REPLACEMENT_PENDING"]),
  expiresAt: instant, totalBytes: positiveInteger, usedBytes: integer, remainingBytes: integer,
  usageHistoryVersion: z.number().int().nonnegative(), observedAt: instant.nullable(),
}).superRefine((value, ctx) => {
  const remaining = BigInt(value.totalBytes) - BigInt(value.usedBytes);
  if (BigInt(value.remainingBytes) !== (remaining > BigInt(0) ? remaining : BigInt(0))) {
    ctx.addIssue({ code: "custom", message: "Inconsistent quota." });
  }
});
export type Entitlement = z.infer<typeof entitlementSchema>;
export const orderSchema = z.strictObject({
  id, owner: ownerSchema, quoteId: id, state: z.enum(orderStates), payment: z.enum(paymentStates),
  provisioning: z.enum(provisioningStates), totalMmk: positiveInteger,
});
export const issueSchema = z.strictObject({
  id, owner: ownerSchema, entitlementId: id, state: z.enum(issueStates),
  attempts: z.number().int().min(0).max(3), createdAt: instant,
});
export const diagnosticsSchema = z.strictObject({
  owner: ownerSchema, entitlement: entitlementSchema,
  identity: ownerSchema, issues: z.array(issueSchema).max(100),
  connectionTest: z.enum(["NOT_TESTED", "SUCCEEDED", "FAILED"]),
}).superRefine((d, ctx) => {
  if (d.owner.subject !== d.identity.subject || d.owner.subject !== d.entitlement.owner.subject ||
      d.issues.some(issue => issue.owner.subject !== d.owner.subject || issue.entitlementId !== d.entitlement.id)) {
    ctx.addIssue({ code: "custom", message: "Ownership mismatch." });
  }
});

// This value cannot accidentally be serialized into a public DTO or inspected in logs.
export class SensitiveCredential {
  #value: string;
  constructor(value: string) { this.#value = z.string().regex(/^ss:\/\/\S+$/).max(4096).parse(value); }
  revealForAuthorizedDelivery(): string { return this.#value; }
  toJSON(): never { throw new Error("Credential serialization forbidden."); }
  toString(): string { return "[REDACTED VPN CREDENTIAL]"; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.toString(); }
}

const target = { owner: ownerSchema, entitlementId: id };
const operationResult = z.strictObject({ owner: ownerSchema, operationId: id, state: z.enum(provisioningStates) });
const reason = z.enum(["CUSTOMER_REPORTED_FAILURE", "ADMIN_CONNECTION_TEST", "VERIFIED_KEY_FAILURE"]);

// All contracts are internal, server-only wire contracts. No public HTTP handlers are registered.
export const contracts = {
  "catalog.get": { mutation: false, permission: null, request: z.strictObject({}), response: z.strictObject({ catalogVersion: id, packages: z.array(packageSchema).max(100) }) },
  "quotes.create": { mutation: true, permission: null, request: z.strictObject({ packageId: id, catalogVersion: id, months: z.number().int().min(1).max(12) }), response: quoteSchema },
  "orders.create": { mutation: true, permission: null, request: z.strictObject({ quoteId: id }), response: orderSchema },
  "orders.get": { mutation: false, permission: null, request: z.strictObject({ orderId: id }), response: orderSchema },
  "entitlements.get": { mutation: false, permission: null, request: z.strictObject({}), response: z.strictObject({ owner: ownerSchema, entitlements: z.array(entitlementSchema).max(100) }) },
  "payments.confirm": { mutation: true, permission: "payments:confirm", request: z.strictObject({ owner: ownerSchema, orderId: id, verificationId: id, amountMmk: positiveInteger, currency: z.literal("MMK") }), response: operationResult },
  "issues.report": { mutation: true, permission: null, request: z.strictObject({ entitlementId: id, category: z.enum(["CANNOT_CONNECT", "UNSTABLE_CONNECTION"]), description: z.string().trim().min(1).max(1000) }), response: issueSchema },
  "issues.retry": { mutation: true, permission: null, request: z.strictObject({ issueId: id, expectedAttempt: z.number().int().min(0).max(2), result: z.enum(["SUCCEEDED", "FAILED"]) }), response: issueSchema },
  "diagnostics.get": { mutation: false, permission: "vpn:diagnostics:read", request: z.strictObject(target), response: diagnosticsSchema },
  "diagnostics.record": { mutation: true, permission: "vpn:diagnostics:write", request: z.strictObject({ ...target, issueId: id, result: z.enum(["SUCCEEDED", "FAILED"]), expectedVersion: z.number().int().nonnegative() }), response: issueSchema },
  "credentials.reveal": { mutation: true, permission: "vpn:credential:reveal", request: z.strictObject({ ...target, issueId: id, reason }), response: z.strictObject({ owner: ownerSchema, keyId: id, credential: z.string().regex(/^ss:\/\/\S+$/).max(4096).transform(value => new SensitiveCredential(value)) }) },
  "replacements.request": { mutation: true, permission: "vpn:replacement:request", request: z.strictObject({ ...target, issueId: id, expectedVersion: z.number().int().nonnegative(), reason: z.literal("VERIFIED_KEY_FAILURE") }), response: z.strictObject({ owner: ownerSchema, operationId: id, state: z.enum(replacementStates) }) },
} as const;

export type Operation = keyof typeof contracts;
export type Input<K extends Operation> = z.input<(typeof contracts)[K]["request"]>;
export type Output<K extends Operation> = z.output<(typeof contracts)[K]["response"]>;
export type Permission = NonNullable<(typeof contracts)[Operation]["permission"]>;

export const errorSchema = z.strictObject({
  version: z.literal(API_VERSION), requestId: z.uuid(),
  code: z.enum(["DISABLED", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "INVALID_REQUEST", "INVALID_RESPONSE", "CONFLICT", "UNAVAILABLE", "AUDIT_UNAVAILABLE"]),
  message: z.string(), retryable: z.boolean(),
});
export type ErrorCode = z.infer<typeof errorSchema>["code"];
