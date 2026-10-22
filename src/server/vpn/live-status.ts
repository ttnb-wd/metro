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
    if (value.owner.subject !== reference.userId || value.id !== reference.externalId || value.version < reference.version
      || previous && BigInt(value.usedBytes) < BigInt(previous.usedBytes)) throw new Error();
    return { entitlement: value, status: serviceStatus(value, now ?? Date.now()), lastObservedAt: value.observedAt ?? previous?.observedAt ?? null };
  } catch { return { entitlement: null, status: serviceStatus(null, now ?? Date.now(), false), lastObservedAt: previous?.observedAt ?? null }; }
}
