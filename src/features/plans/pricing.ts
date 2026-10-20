export const PRESET_MONTHS = [1, 2, 3] as const;
export const MIN_MONTHS = 1;
export const MAX_MONTHS = 12;
export const DAYS_PER_MONTH = 30;

export type PriceEstimate = {
  months: number;
  days: number;
  monthlyPriceMmk: number;
  discountPercent: number;
  regularPriceMmk: number;
  savedMmk: number;
  totalMmk: number;
};

export function durationDiscountPercent(months: number): number {
  if (!Number.isInteger(months) || months < MIN_MONTHS || months > MAX_MONTHS) {
    throw new RangeError("Duration must be a whole number from 1 to 12 months.");
  }
  return (months - 1) * 5;
}

/** UI estimate only. Uses exact integer arithmetic, never floating-point money. */
export function calculatePrice(monthlyPriceMmk: number, months: number): PriceEstimate {
  if (!Number.isSafeInteger(monthlyPriceMmk) || monthlyPriceMmk <= 0) {
    throw new RangeError("Monthly price must be a positive safe integer in MMK.");
  }
  const discountPercent = durationDiscountPercent(months);
  const regular = BigInt(monthlyPriceMmk) * BigInt(months);
  if (regular > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("The regular price exceeds the supported MMK range.");
  }
  // Round the savings once to the nearest whole kyat (half up).
  // Derive the total by subtraction so regular = saved + total always holds.
  const saved = (regular * BigInt(discountPercent) + BigInt(50)) / BigInt(100);
  return {
    months,
    days: months * DAYS_PER_MONTH,
    monthlyPriceMmk,
    discountPercent,
    regularPriceMmk: Number(regular),
    savedMmk: Number(saved),
    totalMmk: Number(regular - saved),
  };
}

const mmkFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatMmk(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("MMK amounts must be nonnegative safe integers.");
  }
  return `${mmkFormatter.format(amount)} MMK`;
}
