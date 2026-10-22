"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publishPricing } from "@/app/admin/actions";
import { defaultDurations, PRICING_POLICY, type PricingState, type WebsiteCatalog } from "@/features/pricing/catalog";
import type { AdminActionState } from "@/features/pricing/action-state";

export function PricingEditor({ initial, requestKey, discountsOnly = false }: { initial: PricingState; requestKey: string; discountsOnly?: boolean }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<WebsiteCatalog>(() => initial.status === "READY" ? initial.release.catalog : { policy: PRICING_POLICY, packages: [], durations: defaultDurations() });
  const [state, action, pending] = useActionState(publishPricing, { status: "idle", message: "" } as AdminActionState);
  const ready = initial.status === "READY" || initial.status === "UNPUBLISHED";
  const version = initial.status === "READY" ? initial.release.version : 0;
  useEffect(() => { if (state.status === "success") router.refresh(); }, [state.status, state.version, router]);
  const updatePackage = (id: string, patch: Partial<WebsiteCatalog["packages"][number]>) => setCatalog(current => ({ ...current, packages: current.packages.map(pkg => pkg.id === id ? { ...pkg, ...patch } : pkg) }));
  return <form action={action} className="admin-pricing-form" aria-busy={pending}>
    <input type="hidden" name="pricing" value={JSON.stringify({ expectedVersion: version, requestKey, catalog })} />
    {discountsOnly && !catalog.packages.length && <p className="admin-small-note">Create your first package in Plans & Pricing before publishing duration discounts.</p>}
    <div className="admin-notice"><strong>{ready ? version ? `Published website version ${version}` : "No website pricing published yet" : "Pricing migration and runtime permissions required"}</strong><p>{ready ? "Publishing creates an immutable version. All public price views update together; existing orders keep their original totals." : "This editor is available for review. Saving is blocked until the additive website pricing migration and restricted runtime grants are separately approved and applied."}</p></div>
    <fieldset disabled={pending || !ready}>
      {!discountsOnly && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Secure Access packages</h2><p>Website prices only · MMK · base allowance per purchased month</p></div><Button type="button" variant="secondary" disabled={catalog.packages.length >= 50} onClick={() => setCatalog(current => ({ ...current, packages: [...current.packages, { id: crypto.randomUUID(), name: "", dataGb: 1, monthlyPriceMmk: "", active: false }] }))}><Plus size={16} aria-hidden="true" />Add package</Button></div>
        {!catalog.packages.length && <p className="admin-inline-empty">Add your first package and enter its actual website price. Nothing is prefilled from Telegram or development examples.</p>}
        <div className="admin-package-list">{catalog.packages.map((pkg, index) => <div className="admin-package-editor" key={pkg.id}><label htmlFor={`package-name-${pkg.id}`}>Package {index + 1}<Input id={`package-name-${pkg.id}`} value={pkg.name} required maxLength={80} onChange={event => updatePackage(pkg.id, { name: event.target.value })} placeholder="Package name" /></label><label htmlFor={`package-gb-${pkg.id}`}>Base GB<Input id={`package-gb-${pkg.id}`} type="number" min={1} max={1000000} step={1} required value={pkg.dataGb || ""} onChange={event => updatePackage(pkg.id, { dataGb: Number(event.target.value) })} /></label><label htmlFor={`package-price-${pkg.id}`}>Base price · MMK<Input id={`package-price-${pkg.id}`} inputMode="numeric" pattern="[1-9][0-9]{0,11}" required value={pkg.monthlyPriceMmk} onChange={event => updatePackage(pkg.id, { monthlyPriceMmk: event.target.value })} placeholder="Whole MMK" /></label><label className="admin-checkbox"><input type="checkbox" checked={pkg.active} onChange={event => updatePackage(pkg.id, { active: event.target.checked })} />Available</label></div>)}</div>
      </section>}
      <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Duration & discount policy</h2><p>One month = 30 days. Total allowance = base GB × months, with no monthly reset.</p></div></div><div className="admin-duration-grid">{catalog.durations.map(duration => <div className="admin-duration-editor" key={duration.months}><label className="admin-checkbox"><input type="checkbox" checked={duration.active} onChange={event => setCatalog(current => ({ ...current, durations: current.durations.map(item => item.months === duration.months ? { ...item, active: event.target.checked } : item) }))} /><strong>{duration.months} {duration.months === 1 ? "month" : "months"}</strong><span>{duration.months * 30} days</span></label><label htmlFor={`discount-${duration.months}`}>Discount %<Input id={`discount-${duration.months}`} type="number" min={0} max={100} step={1} required value={duration.discountPercent} onChange={event => setCatalog(current => ({ ...current, durations: current.durations.map(item => item.months === duration.months ? { ...item, discountPercent: Number(event.target.value) } : item) }))} /></label></div>)}</div><p className="admin-small-note">Default: 5 percentage points per additional month. You control each percentage, including 0–100%. Savings round once to the nearest whole MMK.</p></section>
    </fieldset>
    <div className="admin-save-bar"><div><strong>Publish version {version + 1}</strong><p>A sign-in within the last five minutes is required.</p></div><Button type="submit" disabled={pending || !ready || !catalog.packages.length}>{pending ? "Publishing…" : "Save & publish pricing"}<ArrowUpRight size={16} aria-hidden="true" /></Button></div>
    {state.message && <p role={state.status === "error" ? "alert" : "status"} className="admin-form-result">{state.message}</p>}
  </form>;
}
