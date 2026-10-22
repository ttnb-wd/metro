import type { Entitlement } from "@/server/vpn/contracts";

export const DATA_GB = BigInt(1024 ** 3);
export const STATUS_FRESHNESS_MS = 120_000;
export type ServiceCondition = "ACTIVE" | "LOW_DATA" | "DATA_EXHAUSTED" | "EXPIRED" | "BOTH_EXHAUSTED" | "PAUSED" | "STALE" | "UNAVAILABLE";
export function formatRemaining(bytes: string) {
  const value = BigInt(bytes);
  if (value < BigInt(10486)) return `${value.toLocaleString("en-US")} bytes (less than 0.01 MB)`;
  const unit = value >= DATA_GB ? "GB" : "MB", divisor = unit === "GB" ? Number(DATA_GB) : 1024 ** 2;
  return `${(Number(value) / divisor).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}
/** Call only with an ownership-validated snapshot. Unknown values remain null. */
export function serviceStatus(snapshot: Entitlement | null, now = Date.now(), available = true) {
  const observed = snapshot?.observedAt ? Date.parse(snapshot.observedAt) : NaN;
  const fresh = available && Number.isFinite(observed) && observed <= now + 5000 && now - observed <= STATUS_FRESHNESS_MS;
  let condition: ServiceCondition;
  let reasons: string[];
  if (!snapshot || !available || !Number.isFinite(observed)) { condition = "UNAVAILABLE"; reasons = ["Current VPN usage is unavailable. Refresh before connecting; unknown usage is not zero."]; }
  else if (!fresh) { condition = "STALE"; reasons = ["VPN usage has not been refreshed recently. Refresh before connecting."]; }
  else {
    const exhausted = BigInt(snapshot.remainingBytes) === BigInt(0), expired = Date.parse(snapshot.expiresAt) <= now;
    reasons = [exhausted ? "VPN access stopped because your purchased data was used up." : "", expired ? "Your subscription period has ended." : ""].filter(Boolean);
    if (exhausted && expired) condition = "BOTH_EXHAUSTED";
    else if (exhausted) condition = "DATA_EXHAUSTED";
    else if (expired) condition = "EXPIRED";
    else if (snapshot.status !== "ACTIVE" || snapshot.keyStatus !== "ENFORCED" || !snapshot.keyId) { condition = "PAUSED"; reasons = ["VPN access is paused. Contact Metro support before connecting."]; }
    else if (BigInt(snapshot.remainingBytes) < DATA_GB) { condition = "LOW_DATA"; reasons = [`Your remaining data is ${formatRemaining(snapshot.remainingBytes)}. Top up to keep using Secure Access.`]; }
    else { condition = "ACTIVE"; reasons = ["Your subscription is active."]; }
  }
  return { condition, reasons, canConnect: condition === "ACTIVE" || condition === "LOW_DATA", usageKnown: !!snapshot && fresh,
    remainingBytes: snapshot && fresh ? snapshot.remainingBytes : null, usedBytes: snapshot && fresh ? snapshot.usedBytes : null,
    topUp: ["LOW_DATA", "DATA_EXHAUSTED", "BOTH_EXHAUSTED"].includes(condition), renew: ["EXPIRED", "BOTH_EXHAUSTED"].includes(condition) };
}
