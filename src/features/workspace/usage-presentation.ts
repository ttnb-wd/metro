/** Display only: never used to calculate purchased quota or enforce access. */
export function usagePresentation(usedBytes: string | null, totalBytes: string | null) {
  if (usedBytes === null || totalBytes === null) return null;
  const used = BigInt(usedBytes), total = BigInt(totalBytes);
  if (used < BigInt(0) || total <= BigInt(0)) return null;
  const value = Number(used > total ? total : used) / Number(total) * 100;
  return Number.isFinite(value) ? { value, label: value > 0 && value < .01 ? "<0.01%" : `${value.toFixed(2)}%` } : null;
}
