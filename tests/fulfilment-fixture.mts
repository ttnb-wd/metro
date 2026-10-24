/** Disposable test backend receipt only; never imported by application code. */
export function fixtureReceipt(input: object, result: Record<string, unknown>) {
  const request = input as { operationId: string; orderId: string; quote: Record<string, unknown> };
  const applied = Date.now(), q = request.quote;
  return { protocol: "metro-fulfilment-receipt.v1", operationId: request.operationId, kind: "PROVISION", orderId: request.orderId,
    quoteId: q.id, quoteVersion: q.pricingVersion ?? q.catalogVersion, appliedAt: new Date(applied).toISOString(), completedAt: new Date(applied).toISOString(), purchase: { packageId: q.packageId, quotaBytes: q.quotaBytes, months: q.months, durationDays: q.durationDays }, enforcement: { counterBytes: result.usedBytes, windowBytes: result.usedBytes, counterEpoch: "fixture", verifiedAt: new Date(applied).toISOString() }, before: null,
    entitlement: { ...result, version: 0, expiresAt: new Date(applied + Number(q.durationDays) * 86400000).toISOString(), observedAt: new Date(applied).toISOString() },
    usageOffsetBytes: "0", previousUsageOffsetBytes: "0", verifiedFiniteLimitBytes: result.totalBytes, oldKeyId: null, oldKeyRevoked: false };
}
