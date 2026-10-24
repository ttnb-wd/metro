import "server-only";
import { entitlementSchema } from "./contracts";
import { callVpnService } from "./transport";
import { serviceStatus } from "@/features/workspace/service-status";
type Reference = { userId: string; externalId: string; version: number; snapshot?: unknown };
export async function liveServiceStatus(reference: Reference, transport = callVpnService, now?: number) {
  const saved = entitlementSchema.safeParse(reference.snapshot);
  const previous = saved.success && saved.data.owner.subject === reference.userId && saved.data.id === reference.externalId ? saved.data : null;
  try {
    const value = entitlementSchema.parse(await transport("entitlement", { owner: { issuer: "metro-website", subject: reference.userId }, entitlementId: reference.externalId }));
    // A newer backend mutation is not a verified website activation until the
    // strict worker commits its receipt. Connect/Show Key must not bypass it.
    if (value.owner.subject !== reference.userId || value.id !== reference.externalId || value.version !== reference.version
      || reference.snapshot !== undefined && !previous
      || previous && (BigInt(value.usedBytes) < BigInt(previous.usedBytes) || value.usageHistoryVersion < previous.usageHistoryVersion
        || value.packageId !== previous.packageId || value.keyId !== previous.keyId || value.totalBytes !== previous.totalBytes || value.expiresAt !== previous.expiresAt)) throw new Error();
    return { entitlement: value, status: serviceStatus(value, now ?? Date.now()), lastObservedAt: value.observedAt ?? previous?.observedAt ?? null };
  } catch { return { entitlement: null, status: serviceStatus(null, now ?? Date.now(), false), lastObservedAt: previous?.observedAt ?? null }; }
}
