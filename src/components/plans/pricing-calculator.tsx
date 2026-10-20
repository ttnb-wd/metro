"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, FlaskConical, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { developmentPricing } from "@/config/development-pricing";
import { calculatePrice, DAYS_PER_MONTH, durationDiscountPercent, formatMmk, MAX_MONTHS, PRESET_MONTHS } from "@/features/plans/pricing";

export function PricingCalculator() {
  const id = useId();
  const [packageId, setPackageId] = useState<string>(developmentPricing.packages[0].id);
  const [durationMode, setDurationMode] = useState("1");
  const [customMonths, setCustomMonths] = useState(6);
  const selectedPackage = developmentPricing.packages.find(item => item.id === packageId) ?? developmentPricing.packages[0];
  const months = durationMode === "custom" ? customMonths : Number(durationMode);
  const estimate = calculatePrice(selectedPackage.monthlyPriceMmk, months);

  return <section className="pricing-prototype" aria-labelledby={`${id}-title`}>
    <div className="development-notice" id={`${id}-notice`}>
      <FlaskConical size={19} aria-hidden="true" />
      <div><strong>Development examples · Not a live offer</strong><p>Package sizes and prices below are unverified examples for UI review. Actual prices and data allowance rules must be confirmed before purchase.</p></div>
    </div>
    <div className="pricing-layout">
      <div className="pricing-controls">
        <div className="calculator-title"><ShieldCheck size={22} aria-hidden="true" /><h2 id={`${id}-title`}>Build your Secure Access estimate.</h2></div>
        <fieldset className="pricing-fieldset" aria-describedby={`${id}-notice ${id}-data-note`}>
          <legend><span className="field-step">01</span>Choose a data package</legend>
          <p className="field-hint" id={`${id}-data-note`}>Illustrative package sizes. Renewal and usage rules are not yet verified.</p>
          <div className="package-options">{developmentPricing.packages.map(item => <label className="package-option" key={item.id}>
            <input type="radio" name={`${id}-package`} value={item.id} checked={packageId === item.id} onChange={() => setPackageId(item.id)} />
            <span className="option-content"><span className="option-top"><strong>{item.dataGb} <span>GB</span></strong><span className="selection-mark"><Check size={12} aria-hidden="true" /></span></span><span className="option-price">{formatMmk(item.monthlyPriceMmk)}</span><span className="option-caption">example / 30 days</span></span>
          </label>)}</div>
        </fieldset>
        <fieldset className="pricing-fieldset" aria-describedby={`${id}-duration-note`}>
          <legend><span className="field-step">02</span>Choose a duration</legend>
          <p className="field-hint" id={`${id}-duration-note`}>One subscription month is exactly 30 days, rather than a calendar month.</p>
          <div className="duration-options">{PRESET_MONTHS.map(value => <label className="duration-option" key={value}>
            <input type="radio" name={`${id}-duration`} value={value} checked={durationMode === String(value)} onChange={() => setDurationMode(String(value))} />
            <span className="option-content"><strong>{value} {value === 1 ? "month" : "months"}</strong><span>{value * DAYS_PER_MONTH} days</span><span className="duration-saving">{durationDiscountPercent(value)}% off</span></span>
          </label>)}<label className="duration-option"><input type="radio" name={`${id}-duration`} value="custom" checked={durationMode === "custom"} onChange={() => setDurationMode("custom")} /><span className="option-content"><strong>Custom</strong><span>1–12 months</span><span className="duration-saving">Up to 55% off</span></span></label></div>
          {durationMode === "custom" && <div className="custom-duration"><label htmlFor={`${id}-months`}>Custom duration</label><select id={`${id}-months`} value={customMonths} onChange={event => setCustomMonths(Number(event.target.value))}>{Array.from({ length: MAX_MONTHS }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} {value === 1 ? "month" : "months"} · {value * DAYS_PER_MONTH} days · {durationDiscountPercent(value)}% off</option>)}</select></div>}
        </fieldset>
        <p className="pricing-formula">Each additional month adds 5 percentage points of discount, up to 55% for 12 months.</p>
      </div>
      <aside className="estimate-panel" aria-labelledby={`${id}-estimate-title`}>
        <div className="estimate-heading"><span className="eyebrow">YOUR ESTIMATE</span><span className="preview-badge">Example only</span></div>
        <h2 id={`${id}-estimate-title`}>Secure Access</h2>
        <div className="estimate-breakdown" aria-live="polite" aria-atomic="true">
          <p className="estimate-selection">{selectedPackage.dataGb} GB example package <span>·</span> {estimate.months} {estimate.months === 1 ? "month" : "months"} / {estimate.days} days</p>
          <dl className="estimate-lines">
            <div><dt>Example monthly price</dt><dd>{formatMmk(estimate.monthlyPriceMmk)}</dd></div>
            <div><dt>Regular price <span>× {estimate.months}</span></dt><dd>{formatMmk(estimate.regularPriceMmk)}</dd></div>
            <div><dt>Duration discount</dt><dd>{estimate.discountPercent}%</dd></div>
            <div className="saving-line"><dt>You save</dt><dd>{formatMmk(estimate.savedMmk)}</dd></div>
          </dl>
          <div className="estimate-total"><span>Final estimated total</span><strong>{formatMmk(estimate.totalMmk)}</strong><span>For {estimate.days} days · development example</span></div>
        </div>
        <Button disabled className="w-full">Purchases not available</Button>
        <p className="estimate-disclaimer">This calculator creates no order and collects no payment. Savings are rounded to the nearest whole MMK; the total is regular price minus savings.</p>
        <Link href="/services/secure-access" className="text-link gap-2 text-xs">About Secure Access <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </aside>
    </div>
  </section>;
}
