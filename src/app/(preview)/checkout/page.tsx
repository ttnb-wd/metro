import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getWebsiteRepositories } from "@/server/website";
import { requireWebsiteSession } from "@/server/auth/session";
import { getPublicPricing } from "@/server/pricing";
import { readServerEnvironment } from "@/server/env";
import { paymentMethods, commerceEnabled } from "@/server/commerce/config";
import { evidenceStorageReady } from "@/server/commerce/evidence-store";
import { signCheckoutQuote, checkoutInvoiceSchema } from "@/server/commerce/quote";
import { CheckoutPayment } from "@/components/commerce/checkout-payment";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { safeReturnPath } from "@/features/auth/redirects";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ package?: string; months?: string; version?: string; method?: string; draft?: string }> }) {
  const query = await searchParams, selection = new URLSearchParams();
  for (const key of ["package", "months", "version", "method", "draft"] as const) if (typeof query[key] === "string") selection.set(key, query[key]);
  const returnTo = safeReturnPath(`/checkout?${selection}`);
  const session = await requireWebsiteSession(returnTo === "/dashboard" ? "/checkout" : returnTo);
  const methods = paymentMethods(), env = readServerEnvironment();
  let method = methods.find(item => item.id === query.method) ?? methods[0];
  let signed: ReturnType<typeof signCheckoutQuote> | null = null;
  let invoice: z.infer<typeof checkoutInvoiceSchema> | null = null;
  let draftId: string | undefined;
  if (query.draft) {
    if (!z.uuid().safeParse(query.draft).success) notFound();
    const order = await (await getWebsiteRepositories()).order(query.draft).catch(() => notFound());
    if (order.payment !== "UNVERIFIED" || order.state !== "AWAITING_PAYMENT") redirect(`/dashboard/orders/${order.id}`);
    const saved = checkoutInvoiceSchema.safeParse(order.quoteSnapshot);
    if (saved.success && saved.data.totalMmk === order.totalMmk.toFixed(0) && evidenceStorageReady() && commerceEnabled()) {
      invoice = saved.data; method = saved.data.paymentMethod; draftId = order.id;
    }
  } else {
    const pricing = await getPublicPricing();
    if (pricing.status === "READY" && method && env.enabled && evidenceStorageReady() && commerceEnabled()) {
      try { signed = signCheckoutQuote(pricing.release, { packageId: query.package, months: Number(query.months), version: Number(query.version) }, session.user.id, method, env.secret); invoice = { ...signed.quote, paymentMethod: method }; } catch { /* A changed selection must be reviewed before paying. */ }
    }
  }
  return <div className="page-container checkout-page">
    <header className="checkout-heading"><p className="eyebrow">METRO / CHECKOUT</p><h1>Complete your payment.</h1><p>Pay the exact amount, then submit your screenshot for review.</p></header>
    {invoice && method ? <>
      <section className="checkout-card checkout-summary" aria-label="Your authoritative plan quote">
        <div className="checkout-summary-title"><div><h2>{invoice.packageName}</h2><p>Secure Access · no monthly quota reset</p></div><div className="checkout-total"><span>Exact total</span><strong>{formatWebsiteMmk(invoice.totalMmk)}</strong></div></div>
        <dl className="checkout-facts"><div><dt>Duration</dt><dd>{invoice.durationDays} days</dd></div><div><dt>Total quota</dt><dd>{invoice.totalDataGb} GB</dd></div><div><dt>Regular price</dt><dd>{formatWebsiteMmk(invoice.regularMmk)}</dd></div><div><dt>Discount</dt><dd>{invoice.discountPercent}% · save {formatWebsiteMmk(invoice.savedMmk)}</dd></div></dl>
        <p className="checkout-help">Your accepted total stays fixed. One subscription month is exactly 30 days.</p>
      </section>
      {!draftId && methods.length > 1 && <form method="get" className="checkout-method"><input type="hidden" name="package" value={query.package} /><input type="hidden" name="months" value={query.months} /><input type="hidden" name="version" value={query.version} /><label htmlFor="checkout-method">Payment method</label><select name="method" id="checkout-method" defaultValue={method.id}>{methods.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="text-link">Change method</button></form>}
      <CheckoutPayment key={draftId ?? signed?.token} token={signed?.token ?? ""} orderId={draftId} method={method} totalMmk={invoice.totalMmk} />
    </> : <section className="checkout-card"><h2>Review your selection.</h2><p>Your plan may have changed, or ordering is temporarily unavailable. No payment has been submitted.</p><Link href="/plans" className="text-link">Review current plans →</Link><p><Link href="/dashboard/orders" className="text-link">Find a saved checkout in My Orders →</Link></p></section>}
  </div>;
}
