"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatWebsiteMmk, type PricingRelease, type PricingState, type WebsiteQuote } from "@/features/pricing/catalog";

export function PricingCalculator({ state }: { state: PricingState }) {
  if (state.status !== "READY" || !state.release.catalog.packages.length || !state.release.catalog.durations.some(duration => duration.active)) return <section className="pricing-unavailable"><span className="eyebrow">SECURE ACCESS PLANS</span><h2>Website packages are being prepared.</h2><p>There are no published, available website plans at the moment. Prices will appear here after Metro publishes its website catalog.</p><p>No order or payment is created.</p><Button asChild variant="secondary"><Link href="/services/secure-access">About Secure Access <ArrowUpRight size={15} aria-hidden="true" /></Link></Button></section>;
  return <LivePricingCalculator key={state.release.version} release={state.release} />;
}

function LivePricingCalculator({ release }: { release: PricingRelease }) {
  const id = useId(); const router = useRouter();
  const [packageId, setPackageId] = useState(release.catalog.packages[0].id);
  const [months, setMonths] = useState(release.catalog.durations.find(duration => duration.active)!.months);
  const [custom, setCustom] = useState(false);
  const [quote, setQuote] = useState<WebsiteQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const selectedPackage = release.catalog.packages.find(pkg => pkg.id === packageId)!;
  const durations = release.catalog.durations.filter(duration => duration.active);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/pricing/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: release.version, packageId, months }), signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) { if (!controller.signal.aborted) setError(typeof data.message === "string" ? data.message : "The estimate is unavailable. Please retry."); return; }
        if (!controller.signal.aborted) setQuote(data.quote);
      } catch { if (!controller.signal.aborted) setError("We could not load your estimate. Check your connection and retry."); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [packageId, months, release.version, retry]);
  const changeMonths = (value: number) => { if (value === months) return; setMonths(value); setQuote(null); setError(null); };
  return <section className="pricing-prototype" aria-labelledby={`${id}-title`}>
    <div className="development-notice"><ShieldCheck size={19} aria-hidden="true" /><div><strong>Metro website pricing · Version {release.version}</strong><p>Each subscription month is exactly 30 days. Your quote is confirmed before you place an order.</p></div></div>
    <div className="pricing-layout"><div className="pricing-controls"><div className="calculator-title"><ShieldCheck size={22} aria-hidden="true" /><h2 id={`${id}-title`}>Build your Secure Access plan.</h2></div>
      <fieldset className="pricing-fieldset"><legend><span className="field-step">01</span>Choose a data package</legend><p className="field-hint">Total allowance is base GB × purchased months. No monthly reset. 1 package GB = 1,073,741,824 bytes.</p><div className="package-options">{release.catalog.packages.map(pkg => <label className="package-option" key={pkg.id}><input type="radio" name={`${id}-package`} value={pkg.id} checked={packageId === pkg.id} onChange={() => { setPackageId(pkg.id); setQuote(null); setError(null); }} /><span className="option-content"><span className="option-top"><strong>{pkg.dataGb} <span>GB</span></strong><span className="selection-mark"><Check size={12} aria-hidden="true" /></span></span><span className="option-price">{formatWebsiteMmk(pkg.monthlyPriceMmk)}</span><span className="option-caption">{pkg.name} · base / 30 days</span></span></label>)}</div></fieldset>
      <fieldset className="pricing-fieldset"><legend><span className="field-step">02</span>Choose a duration</legend><p className="field-hint">Each subscription month is exactly 30 days. Availability and discounts follow the current website catalog.</p><div className="duration-options">{durations.filter(duration => duration.months <= 3).map(duration => <label className="duration-option" key={duration.months}><input type="radio" name={`${id}-duration`} checked={!custom && months === duration.months} onChange={() => { setCustom(false); changeMonths(duration.months); }} /><span className="option-content"><strong>{duration.months} {duration.months === 1 ? "month" : "months"}</strong><span>{duration.months * 30} days</span><span className="duration-saving">{duration.discountPercent}% off</span></span></label>)}<label className="duration-option"><input type="radio" name={`${id}-duration`} checked={custom || months > 3} onChange={() => setCustom(true)} /><span className="option-content"><strong>Custom</strong><span>Available durations</span><span className="duration-saving">1–12 months</span></span></label></div>{(custom || months > 3) && <div className="custom-duration"><label htmlFor={`${id}-months`}>Custom duration</label><select id={`${id}-months`} value={months} onChange={event => changeMonths(Number(event.target.value))}>{durations.map(duration => <option key={duration.months} value={duration.months}>{duration.months} months · {duration.months * 30} days · {duration.discountPercent}% off</option>)}</select></div>}</fieldset>
    </div><aside className="estimate-panel" aria-labelledby={`${id}-estimate-title`}><div className="estimate-heading"><span className="eyebrow">YOUR ESTIMATE</span><span className="preview-badge">Website v{release.version}</span></div><h2 id={`${id}-estimate-title`}>{selectedPackage.name}</h2><div className="estimate-breakdown" aria-live="polite" aria-atomic="true" aria-busy={!quote && !error}>{error ? <div><p role="alert">{error}</p><Button variant="secondary" onClick={() => { setError(null); setRetry(value => value + 1); }}>Retry estimate</Button><Button variant="ghost" onClick={() => router.refresh()}>Refresh prices</Button></div> : !quote ? <p>Calculating your current website price…</p> : <><p className="estimate-selection">{quote.totalDataGb} GB total <span>·</span> {quote.durationDays} days</p><dl className="estimate-lines"><div><dt>Base price / 30 days</dt><dd>{formatWebsiteMmk(quote.monthlyPriceMmk)}</dd></div><div><dt>Regular price × {quote.months}</dt><dd>{formatWebsiteMmk(quote.regularMmk)}</dd></div><div><dt>Duration discount</dt><dd>{quote.discountPercent}%</dd></div><div className="saving-line"><dt>You save</dt><dd>{formatWebsiteMmk(quote.savedMmk)}</dd></div></dl><div className="estimate-total"><span>Estimated total</span><strong>{formatWebsiteMmk(quote.totalMmk)}</strong><span>{quote.totalDataGb} GB · {quote.durationDays} days · no monthly reset</span></div></>}</div>
      {quote ? <Button className="w-full" asChild><Link href={`/checkout?package=${quote.packageId}&months=${quote.months}&version=${quote.pricingVersion}`}>Review quote <ArrowUpRight size={15} aria-hidden="true" /></Link></Button> : <Button className="w-full" disabled>Estimate unavailable</Button>}<p className="estimate-disclaimer">Server-calculated in whole MMK. This estimate creates no order and takes no payment. Pricing is checked again at checkout.</p>
    </aside></div>
  </section>;
}
