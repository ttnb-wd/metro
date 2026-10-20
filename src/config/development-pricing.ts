export type DevelopmentDataPackage = {
  id: string;
  dataGb: number;
  monthlyPriceMmk: number;
};

// Unverified development fixtures, deliberately separate from billing.
// Intended authority: the existing production bot's monthly plan configuration.
// No production configuration, database, bot, or API was accessed for this step.
// Never import these fixtures into a future order/payment implementation.
export const developmentPricing = {
  source: "development-examples",
  verifiedForBilling: false,
  packages: [
    { id: "example-50gb", dataGb: 50, monthlyPriceMmk: 10_000 },
    { id: "example-100gb", dataGb: 100, monthlyPriceMmk: 18_000 },
    { id: "example-200gb", dataGb: 200, monthlyPriceMmk: 30_000 },
  ] satisfies readonly DevelopmentDataPackage[],
} as const;
