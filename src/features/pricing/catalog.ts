import { z } from "zod";

export const PRICING_POLICY = "metro-website-pricing.v1" as const;
export const PRICING_MIGRATION = "20261020020000_website_pricing";
export const defaultDurations = () => Array.from({ length: 12 }, (_, index) => ({ months: index + 1, discountPercent: index * 5, active: true }));
const safeName = z.string().trim().min(1).max(80).refine(value => !/[\p{Cc}\p{Cf}<>]/u.test(value));
export const MAX_PACKAGE_GB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 ** 3 * 12));
export const websitePackageSchema = z.strictObject({
  id: z.uuid(), name: safeName, dataGb: z.number().int().min(1).max(MAX_PACKAGE_GB),
  monthlyPriceMmk: z.string().regex(/^[1-9][0-9]{0,11}$/), active: z.boolean(),
});
export const durationSchema = z.strictObject({ months: z.number().int().min(1).max(12), discountPercent: z.number().int().min(0).max(100), active: z.boolean() });
export const catalogSchema = z.strictObject({
  policy: z.literal(PRICING_POLICY), packages: z.array(websitePackageSchema).min(1).max(50), durations: z.array(durationSchema).length(12),
}).superRefine((value, ctx) => {
  if (new Set(value.packages.map(item => item.id)).size !== value.packages.length ||
      value.durations.some((duration, index) => duration.months !== index + 1)) ctx.addIssue({ code: "custom", message: "Package IDs and duration months must be unique and ordered." });
});
export const publishPricingSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2_000_000_000), requestKey: z.uuid(), catalog: catalogSchema,
});
export const quoteSelectionSchema = z.strictObject({ version: z.number().int().positive(), packageId: z.uuid(), months: z.number().int().min(1).max(12) });
export type WebsiteCatalog = z.infer<typeof catalogSchema>;
export type WebsitePackage = z.infer<typeof websitePackageSchema>;
export type PricingRelease = { id: string; version: number; createdAt: string; catalog: WebsiteCatalog };
export type PricingState = { status: "READY"; release: PricingRelease } | { status: "MIGRATION_PENDING" | "UNPUBLISHED" | "UNAVAILABLE" };
export type WebsiteQuote = ReturnType<typeof calculateWebsiteQuote>;

/** Whole-MMK savings rounded half up once. Match the existing engine's GB unit. */
export function calculateWebsiteQuote(release: PricingRelease, input: unknown) {
  const selection = quoteSelectionSchema.parse(input);
  if (selection.version !== release.version) throw new Error("PRICING_CHANGED");
  const pkg = release.catalog.packages.find(item => item.id === selection.packageId && item.active);
  const duration = release.catalog.durations.find(item => item.months === selection.months && item.active);
  if (!pkg || !duration) throw new Error("PLAN_UNAVAILABLE");
  const regular = BigInt(pkg.monthlyPriceMmk) * BigInt(duration.months);
  const saved = (regular * BigInt(duration.discountPercent) + BigInt(50)) / BigInt(100);
  return {
    policy: PRICING_POLICY, pricingVersion: release.version, pricingReleaseId: release.id,
    packageId: pkg.id, packageName: pkg.name, months: duration.months, durationDays: duration.months * 30,
    baseDataGb: pkg.dataGb, totalDataGb: pkg.dataGb * duration.months,
    quotaBytes: (BigInt(pkg.dataGb) * BigInt(1024 ** 3) * BigInt(duration.months)).toString(),
    monthlyPriceMmk: pkg.monthlyPriceMmk, regularMmk: regular.toString(), discountPercent: duration.discountPercent,
    savedMmk: saved.toString(), totalMmk: (regular - saved).toString(), currency: "MMK" as const,
  };
}

export function formatWebsiteMmk(value: string): string {
  if (!/^(0|[1-9][0-9]{0,29})$/.test(value)) throw new Error("Invalid MMK amount.");
  return `${new Intl.NumberFormat("en-US").format(BigInt(value))} MMK`;
}
