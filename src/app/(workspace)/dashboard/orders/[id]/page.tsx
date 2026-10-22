import { LiveRefresh } from "@/components/commerce/live-refresh";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWebsiteSession } from "@/server/auth/session";
import { getWebsiteRepositories } from "@/server/website";
import { paymentMethodSchema } from "@/server/commerce/config";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { orderNumber } from "@/features/pricing/receipt";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { customerOrderStatus } from "@/features/pricing/order-status";
import { EvidenceUpload } from "@/components/commerce/commerce-forms";
import { PaymentInstructions } from "@/components/commerce/payment-instructions";
import { ServiceRefreshButton } from "@/components/commerce/connect-panel";
import { PageHeading } from "@/components/dashboard/workspace-components";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireWebsiteSession(`/dashboard/orders/${id}`);
  const repo = await getWebsiteRepositories();
  const order = await repo.order(id).catch(() => notFound());
  const [evidence, updates] = await Promise.all([repo.listEvidence(id), repo.orderUpdates(id)]);
  const snapshot = order.quoteSnapshot as Record<string, unknown>, method = paymentMethodSchema.safeParse(snapshot.paymentMethod), status = customerOrderStatus(order);
  return <><PageHeading title="Your order" eyebrow="ORDER DETAILS" description={orderNumber(order.id)} />
    <LiveRefresh enabled={order.state === "AWAITING_PAYMENT" || order.state === "FULFILMENT_PENDING"} />
    <section className="workspace-panel order-detail"><h2>{typeof snapshot.packageName === "string" ? snapshot.packageName : "Secure Access"}</h2>
      <div className="order-status" role="status"><h3>{status.title}</h3><p>{status.message}</p>{order.payment === "UNVERIFIED" && <Link href={`/checkout?draft=${order.id}`} className="text-link">Continue checkout →</Link>}<ServiceRefreshButton label="Refresh order status" /></div>
      <dl className="workspace-service-facts"><div><dt>Agreed total</dt><dd>{formatWebsiteMmk(order.totalMmk.toFixed(0))}</dd></div><div><dt>Purchased allowance</dt><dd>{typeof snapshot.totalDataGb === "number" ? `${snapshot.totalDataGb} GB · no monthly reset` : "See original quote"}</dd></div><div><dt>Purchased duration</dt><dd>{typeof snapshot.durationDays === "number" ? `${snapshot.durationDays} days` : "See original quote"}</dd></div><div><dt>Payment</dt><dd>{order.payment.replaceAll("_", " ")}</dd></div><div><dt>VPN fulfilment</dt><dd>{order.provisioning.replaceAll("_", " ")}</dd></div></dl>
      {updates.length > 0 && <section className="payment-feedback"><h3>Payment review history</h3><ol>{updates.map(update => <li key={update.id}><p>{update.payload.message}</p><time dateTime={update.createdAt.toISOString()}>{formatMyanmarTime(update.createdAt)}</time></li>)}</ol></section>}
      {method.success && order.state === "AWAITING_PAYMENT" && <><h3>Payment instructions</h3><PaymentInstructions method={method.data} totalMmk={order.totalMmk.toFixed(0)} orderId={order.id} />{order.payment === "UNDER_REVIEW" ? <details><summary className="text-link">Need to submit a corrected receipt?</summary><EvidenceUpload orderId={order.id} resubmission /></details> : <EvidenceUpload orderId={order.id} resubmission={order.payment === "REJECTED"} />}</>}
      {evidence.length > 0 && <><h3>Submitted proof</h3><ul className="proof-history">{evidence.map(file => <li key={file.id}><a className="text-link" href={`/api/evidence/${file.id}?view=1`} target="_blank" rel="noopener noreferrer">View proof · {formatMyanmarTime(file.createdAt)} ↗</a><a className="text-link" href={`/api/evidence/${file.id}`}>Download proof</a></li>)}</ul></>}
      <div className="workspace-access-actions">{evidence.length > 0 && <><Link href={`/dashboard/orders/${id}/receipt`} className="text-link">View / print Metro receipt →</Link><a href={`/api/orders/${id}/receipt?download=1`} className="text-link">Download receipt (.html)</a></>}{order.payment === "CONFIRMED" && <Link href="/dashboard/secure-access" className="text-link">Open Secure Access →</Link>}<Link href="/dashboard/orders" className="text-link">Back to orders →</Link></div>
    </section></>;
}
