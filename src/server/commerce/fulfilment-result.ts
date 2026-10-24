import "server-only";
import { z } from "zod";
import { entitlementSchema, bytes, instant, type Entitlement } from "../vpn/contracts";

/** A signed HTTPS backend result must attest its durable operation, not just
 * echo an arbitrary current entitlement. No Outline enforcement happens here. */
export const fulfilmentReceiptSchema = z.strictObject({
  protocol: z.literal("metro-fulfilment-receipt.v1"), operationId: z.uuid(),
  kind: z.enum(["PROVISION", "REPLACEMENT"]), orderId: z.uuid().nullable(),
  quoteId: z.string().nullable(), quoteVersion: z.union([z.string(), z.number().int()]).nullable(),
  appliedAt: instant, completedAt: instant, before: entitlementSchema.nullable(), entitlement: entitlementSchema,
  purchase: z.strictObject({ packageId: z.string(), quotaBytes: bytes, months: z.number().int().min(1).max(12), durationDays: z.number().int().min(30).max(360) }).nullable(),
  enforcement: z.strictObject({ counterBytes: bytes, windowBytes: bytes, counterEpoch: z.string().min(1).max(128), verifiedAt: instant }),
  usageOffsetBytes: bytes, previousUsageOffsetBytes: bytes,
  verifiedFiniteLimitBytes: bytes, oldKeyId: z.string().nullable(), oldKeyRevoked: z.boolean(),
});
type Operation = { id: string; userId: string; kind: string; orderId: string | null; expectedVersion: number | null; createdAt: Date; frozenSnapshot: unknown };
export function validateFulfilmentResult(raw: unknown, operation: Operation, now = Date.now(), known?: Entitlement) {
  const r = fulfilmentReceiptSchema.parse(raw), result = r.entitlement, before = r.before;
  const snapshot = operation.frozenSnapshot as Record<string, unknown>;
  const reject = () => { throw new Error("Invalid fulfilment receipt."); };
  if (r.operationId !== operation.id || r.kind !== operation.kind || r.orderId !== operation.orderId
    || result.owner.issuer !== "metro-website" || result.owner.subject !== operation.userId
    || result.status !== "ACTIVE" || result.keyStatus !== "ENFORCED" || !result.keyId
    || !result.observedAt || Date.parse(result.observedAt) < Date.parse(r.appliedAt)
    || Date.parse(result.observedAt) > now + 30_000 || now - Date.parse(result.observedAt) > 300_000
    || Date.parse(r.appliedAt) < operation.createdAt.getTime() - 1000 || Date.parse(r.appliedAt) > now + 30_000
    || Date.parse(r.completedAt) < Date.parse(r.appliedAt) || Date.parse(r.completedAt) > now + 30_000
    || Date.parse(r.completedAt) > Date.parse(r.enforcement.verifiedAt) + 30_000 || r.enforcement.verifiedAt !== result.observedAt
    || Date.parse(result.expiresAt) <= now || BigInt(result.remainingBytes) <= BigInt(0)) reject();
  if (before && (!before.observedAt || Date.parse(before.observedAt) > Date.parse(r.appliedAt)
    || Date.parse(r.appliedAt) - Date.parse(before.observedAt) > 300_000
    || before.owner.subject !== operation.userId || before.owner.issuer !== result.owner.issuer
    || before.id !== result.id || result.version !== before.version + 1
    || BigInt(result.usedBytes) < BigInt(before.usedBytes) || result.usageHistoryVersion < before.usageHistoryVersion)) reject();
  if (known) {
    if (!before || known.id !== result.id || known.owner.subject !== operation.userId || known.version > result.version
      || BigInt(known.usedBytes) > BigInt(result.usedBytes) || BigInt(known.totalBytes) > BigInt(result.totalBytes)
      || known.usageHistoryVersion > result.usageHistoryVersion || Date.parse(known.expiresAt) > Date.parse(result.expiresAt)
      || operation.kind === "PROVISION" && known.keyId !== result.keyId) reject();
    if (before && known.version <= before.version && (BigInt(before.totalBytes) < BigInt(known.totalBytes)
      || BigInt(before.usedBytes) < BigInt(known.usedBytes) || before.usageHistoryVersion < known.usageHistoryVersion
      || Date.parse(before.expiresAt) < Date.parse(known.expiresAt)
      || known.version === before.version && (before.totalBytes !== known.totalBytes || before.expiresAt !== known.expiresAt))) reject();
  }
  const offset = BigInt(r.usageOffsetBytes), priorOffset = BigInt(r.previousUsageOffsetBytes);
  const ceiling = BigInt(result.totalBytes) - offset, windowLimit = BigInt(r.enforcement.windowBytes) + BigInt(result.remainingBytes);
  const expectedLimit = windowLimit < ceiling ? windowLimit : ceiling;
  if (offset > BigInt(result.usedBytes) || BigInt(r.verifiedFiniteLimitBytes) <= BigInt(0)
    || offset + BigInt(r.enforcement.counterBytes) !== BigInt(result.usedBytes)
    || BigInt(r.verifiedFiniteLimitBytes) !== expectedLimit) reject();
  if (operation.kind === "PROVISION") {
    if (!r.purchase || r.purchase.packageId !== snapshot.packageId || r.purchase.quotaBytes !== snapshot.quotaBytes
      || r.purchase.months !== snapshot.months || r.purchase.durationDays !== snapshot.durationDays
      || r.quoteId !== snapshot.id || r.quoteVersion !== (snapshot.pricingVersion ?? snapshot.catalogVersion)
      || result.packageId !== snapshot.packageId || snapshot.durationDays !== Number(snapshot.months) * 30
      || !Number.isInteger(snapshot.months) || Number(snapshot.months) < 1 || Number(snapshot.months) > 12
      || !/^[1-9][0-9]*$/.test(String(snapshot.quotaBytes))) reject();
    const expectedTotal = BigInt(before?.totalBytes ?? "0") + BigInt(String(snapshot.quotaBytes));
    const expectedExpiry = Math.max(Date.parse(r.appliedAt), before ? Date.parse(before.expiresAt) : 0) + Number(snapshot.durationDays) * 86_400_000;
    if (BigInt(result.totalBytes) !== expectedTotal || Date.parse(result.expiresAt) !== expectedExpiry
      || before && (result.keyId !== before.keyId || offset !== priorOffset || priorOffset > BigInt(before.usedBytes))
      || !before && (result.version !== 0 || offset !== BigInt(0) || priorOffset !== BigInt(0))
      || r.oldKeyRevoked || r.oldKeyId !== null) reject();
  } else {
    const frozen = entitlementSchema.parse(snapshot);
    if (!before || r.purchase !== null || r.quoteId !== null || r.quoteVersion !== null || operation.expectedVersion !== frozen.version
      || before.version !== frozen.version || before.id !== frozen.id || before.keyId !== frozen.keyId
      || before.totalBytes !== frozen.totalBytes || before.expiresAt !== frozen.expiresAt || BigInt(before.usedBytes) < BigInt(frozen.usedBytes)
      || result.packageId !== frozen.packageId || result.keyId === frozen.keyId || result.expiresAt !== frozen.expiresAt
      || result.totalBytes !== frozen.totalBytes || offset !== BigInt(before.usedBytes)
      || r.oldKeyId !== frozen.keyId || !r.oldKeyRevoked) reject();
  }
  return result;
}
