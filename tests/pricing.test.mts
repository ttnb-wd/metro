import { test } from "node:test";
import assert from "node:assert/strict";
import { calculatePrice, durationDiscountPercent, formatMmk } from "../src/features/plans/pricing.ts";

test("approved preset and maximum-duration prices", () => {
  for (const [months, discount, days, regular, saved, total] of [
    [1, 0, 30, 10_000, 0, 10_000],
    [2, 5, 60, 20_000, 1_000, 19_000],
    [3, 10, 90, 30_000, 3_000, 27_000],
    [12, 55, 360, 120_000, 66_000, 54_000],
  ]) {
    const result = calculatePrice(10_000, months);
    assert.equal(result.discountPercent, discount);
    assert.equal(result.days, days);
    assert.equal(result.regularPriceMmk, regular);
    assert.equal(result.savedMmk, saved);
    assert.equal(result.totalMmk, total);
  }
});

test("all twelve durations conserve whole-MMK totals", () => {
  for (const monthlyPrice of [1, 7, 99, 10_000, 18_000, 30_000, 71_999]) {
    for (let months = 1; months <= 12; months++) {
      const result = calculatePrice(monthlyPrice, months);
      assert.equal(result.discountPercent, (months - 1) * 5);
      assert.equal(result.days, months * 30);
      assert.equal(result.regularPriceMmk, result.savedMmk + result.totalMmk);
      assert.ok(Number.isSafeInteger(result.savedMmk));
      assert.ok(Number.isSafeInteger(result.totalMmk));
      assert.ok(result.totalMmk > 0);
      assert.ok(result.savedMmk >= 0);
    }
  }
});

test("half-kyat savings round up exactly once", () => {
  const result = calculatePrice(1, 6);
  assert.equal(result.regularPriceMmk, 6);
  assert.equal(result.discountPercent, 25);
  assert.equal(result.savedMmk, 2);
  assert.equal(result.totalMmk, 4);
});

test("large safe integers do not lose precision in intermediate percentages", () => {
  const monthlyPrice = Math.floor(Number.MAX_SAFE_INTEGER / 12);
  const result = calculatePrice(monthlyPrice, 12);
  const exactRegular = BigInt(monthlyPrice) * BigInt(12);
  const exactSavings = (exactRegular * BigInt(55) + BigInt(50)) / BigInt(100);
  assert.equal(result.regularPriceMmk, Number(exactRegular));
  assert.equal(result.savedMmk, Number(exactSavings));
  assert.equal(result.totalMmk, Number(exactRegular - exactSavings));
});

test("invalid durations, prices and unsafe totals are rejected", () => {
  for (const months of [0, 13, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => calculatePrice(10_000, months), RangeError);
    assert.throws(() => durationDiscountPercent(months), RangeError);
  }
  for (const price of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculatePrice(price, 1), RangeError);
  }
  assert.throws(() => calculatePrice(Number.MAX_SAFE_INTEGER, 2), RangeError);
});

test("MMK display keeps whole kyat and explicit currency", () => {
  assert.equal(formatMmk(0), "0 MMK");
  assert.equal(formatMmk(54_000), "54,000 MMK");
  for (const amount of [-1, 0.5, Infinity, NaN]) assert.throws(() => formatMmk(amount), RangeError);
});
