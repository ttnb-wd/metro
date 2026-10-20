import "server-only";
import { quoteSchema, packageSchema, entitlementSchema, bytes, type Entitlement, type Owner } from "./contracts";
import { sameOwner } from "./identity";

export function priceQuote(input: { id: string; owner: Owner; pkg: unknown; catalogVersion: string; months: number; validUntil: string }) {
  const pkg = packageSchema.parse(input.pkg);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 12) throw new Error("Invalid duration.");
  const months = BigInt(input.months);
  const regular = BigInt(pkg.monthlyPriceMmk) * months;
  const discount = (input.months - 1) * 5;
  const saved = (regular * BigInt(discount) + BigInt(50)) / BigInt(100);
  return quoteSchema.parse({ id: input.id, owner: input.owner, packageId: pkg.id,
    catalogVersion: input.catalogVersion, pricingPolicy: "website-30d-v1", months: input.months,
    durationDays: input.months * 30, monthlyPriceMmk: pkg.monthlyPriceMmk,
    monthlyQuotaBytes: pkg.monthlyQuotaBytes, regularMmk: String(regular), discountPercent: discount,
    savedMmk: String(saved), totalMmk: String(regular - saved),
    quotaBytes: String(BigInt(pkg.monthlyQuotaBytes) * months), validUntil: input.validUntil });
}

// Policy validation only: never writes a subscription or calls Outline.
export function renewalTarget(current: Entitlement, purchasedBytes: string, months: number, now: string) {
  entitlementSchema.parse(current);
  if (!/^[1-9][0-9]{0,29}$/.test(purchasedBytes) || !Number.isInteger(months) || months < 1 || months > 12) throw new Error("Invalid renewal.");
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid timestamp.");
  const used = BigInt(current.usedBytes);
  const remaining = BigInt(current.remainingBytes) + BigInt(purchasedBytes);
  const total = used + remaining;
  bytes.parse(String(total));
  return { totalBytes: String(total), usedBytes: current.usedBytes,
    remainingBytes: String(remaining),
    expiresAt: new Date(Math.max(timestamp, Date.parse(current.expiresAt)) + months * 30 * 86400000).toISOString() };
}

export function assertReplacementPreserved(before: Entitlement, after: Entitlement,
  proof: { installedLimitBytes: string; oldKeyDisabled: boolean; limitVerified: boolean }) {
  entitlementSchema.parse(before); entitlementSchema.parse(after);
  if (!sameOwner(before.owner, after.owner) || before.id !== after.id || before.packageId !== after.packageId ||
      !before.keyId || !after.keyId || before.keyId === after.keyId ||
      before.status !== "ACTIVE" || after.status !== "ACTIVE" || before.keyStatus !== "ENFORCED" || after.keyStatus !== "ENFORCED" ||
      before.expiresAt !== after.expiresAt || before.totalBytes !== after.totalBytes ||
      before.usedBytes !== after.usedBytes || before.remainingBytes !== after.remainingBytes ||
      before.usageHistoryVersion !== after.usageHistoryVersion || after.version !== before.version + 1 ||
      BigInt(before.remainingBytes) <= BigInt(0) || proof.installedLimitBytes !== before.remainingBytes ||
      !proof.oldKeyDisabled || !proof.limitVerified) throw new Error("Replacement preservation check failed.");
}
