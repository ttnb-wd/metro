import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PRICING_POLICY, defaultDurations, catalogSchema } from "@/features/pricing/catalog";
// Import accepts current source values only. No development fixtures or price
// fallback; subsequent publication is controlled independently by the OWNER.
const sourceSchema = z.strictObject({ capturedAt: z.iso.datetime(), packages: z.array(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(80), dataGb: z.coerce.number().int().positive().max(1_000_000), monthlyPriceMmk: z.string().regex(/^[1-9][0-9]{0,11}(?:\.0+)?$/).transform(value => value.split(".")[0]), durationDays: z.literal(30) })).min(1).max(50) });
export function importedCatalog(input: unknown, now = Date.now()) {
  const data = sourceSchema.parse(input);
  if (Math.abs(now - Date.parse(data.capturedAt)) > 60_000) throw new Error("A current verified backend catalog is required.");
  if (new Set(data.packages.map(item => item.id)).size !== data.packages.length) throw new Error("Duplicate source package.");
  return catalogSchema.parse({ policy: PRICING_POLICY, durations: defaultDurations(), packages: data.packages.map(item => {
    const hash = createHash("sha256").update(`metro-initial-package:${item.id}`).digest("hex");
    return { id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`, name: item.name, dataGb: item.dataGb, monthlyPriceMmk: item.monthlyPriceMmk, active: true };
  }) });
}
