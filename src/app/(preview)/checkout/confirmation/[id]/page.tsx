import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireWebsiteSession } from "@/server/auth/session";
import { getAccountDestination } from "@/server/auth/account-routing";
import { getWebsiteRepositories } from "@/server/website";
import { FoundationError } from "@/server/owner/authorization";
import { orderNumber } from "@/features/pricing/receipt";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { customerOrderStatus } from "@/features/pricing/order-status";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { Button } from "@/components/ui/button";
import { LiveRefresh } from "@/components/commerce/live-refresh";

export default async function OrderConfirmation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, session = await requireWebsiteSession(`/checkout/confirmation/${id}`);
  const repository = await getWebsiteRepositories(), order = await repository.order(id).catch(error => { if (error instanceof FoundationError && error.code === "NOT_FOUND") notFound(); throw error; });
  if (order.payment === "UNVERIFIED") redirect(`/checkout?draft=${id}`);
  const receipt = await repository.orderReceipt(id), dashboard = await getAccountDestination(session), status = customerOrderStatus(order);
  return <div className="page-container checkout-page"><LiveRefresh enabled={order.payment === "UNDER_REVIEW" || order.state === "FULFILMENT_PENDING"} /><section className="checkout-card order-confirmation"><p className="eyebrow">METRO / ORDER SUBMITTED</p><h1>Thank you. We have received your submission.</h1><p role="status">{order.payment === "UNDER_REVIEW" ? "Your payment is under review. Once approved, your VPN access will be activated automatically." : status.message}</p><dl className="confirmation-facts"><div><dt>Order number</dt><dd>{orderNumber(id)}</dd></div><div><dt>Package</dt><dd>{receipt.plan.packageName} · {receipt.plan.totalDataGb} GB · {receipt.plan.durationDays} days</dd></div><div><dt>Order amount</dt><dd>{formatWebsiteMmk(receipt.plan.totalMmk)}</dd></div><div><dt>Current status</dt><dd>{status.title}</dd></div><div><dt>Submitted</dt><dd>{formatMyanmarTime(receipt.submittedAt)}</dd></div></dl><div className="workspace-access-actions"><Button asChild><Link href={dashboard === "/admin" ? `/admin/orders/${id}` : `/dashboard/orders/${id}`}>View Order</Link></Button><Button variant="secondary" asChild><Link href={dashboard}>Dashboard</Link></Button></div><p className="checkout-help">Your order is saved to your account. Please do not send the payment again.</p></section></div>;
}
