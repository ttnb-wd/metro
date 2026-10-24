import { randomUUID } from "node:crypto";
import { adminPage, getAdminRepository } from "@/server/admin";
import { AdminHeading } from "@/components/admin/admin-views";
import { PaymentApprovalForm, PaymentRejectionForm } from "@/components/admin/payment-review";
import { PrivateEvidencePreview } from "@/components/admin/private-evidence-preview";
import { LiveRefresh } from "@/components/commerce/live-refresh";
import { FulfilmentRetry } from "@/components/admin/fulfilment-retry";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { orderNumber, receiptPaymentLabel } from "@/features/pricing/receipt";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { fulfilmentEnabled } from "@/server/commerce/config";
import { serviceConfigured } from "@/server/vpn/transport";
export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, order = await adminPage(async () => (await getAdminRepository()).order(id));
  return <><AdminHeading title="Order details" description={`${order.user.name} · ${order.user.email}`} /><LiveRefresh enabled={order.state === "AWAITING_PAYMENT" || order.state === "FULFILMENT_PENDING"} />
    <section className="admin-panel"><dl className="admin-details"><div><dt>Order number</dt><dd>{orderNumber(order.id)}</dd></div><div><dt>Customer</dt><dd>{order.user.name} · {order.user.email}</dd></div>{order.plan && <><div><dt>Purchased package</dt><dd>{order.plan.packageName}</dd></div><div><dt>Purchased allowance</dt><dd>{order.plan.totalDataGb} GB · no monthly reset</dd></div><div><dt>Purchased duration</dt><dd>{order.plan.durationDays} days · pricing v{order.plan.pricingVersion}</dd></div></>}<div><dt>Historical agreed total</dt><dd>{formatWebsiteMmk(order.totalMmk)}</dd></div><div><dt>Payment method</dt><dd>{order.paymentMethod ? `${order.paymentMethod.name} · ${order.paymentMethod.accountName} · ${order.paymentMethod.accountNumber}` : "Not recorded"}</dd></div><div><dt>Order created</dt><dd>{formatMyanmarTime(order.createdAt)}</dd></div><div><dt>Payment</dt><dd>{receiptPaymentLabel(order.payment)}</dd></div><div><dt>Fulfilment</dt><dd>{order.state.replaceAll("_", " ")} · {order.provisioning.replaceAll("_", " ")}</dd></div></dl>
    <h2>Submitted payment screenshots</h2>{order.evidence.length ? <ul className="admin-evidence-list">{order.evidence.map(file => <li key={file.id}><h3>Payment proof</h3><p>Order {orderNumber(order.id)} · Submitted {formatMyanmarTime(file.createdAt)}</p><PrivateEvidencePreview id={file.id} />{file.decisions.length ? file.decisions.map((decision, index) => <p key={index}>{decision.decision} · {formatMyanmarTime(decision.createdAt)}</p>) : order.state === "AWAITING_PAYMENT" && order.payment === "UNDER_REVIEW" ? <><PaymentApprovalForm evidenceId={file.id} reviewedVersion={order.version} reviewedSha256={file.sha256} requestKey={randomUUID()} enabled={fulfilmentEnabled() && serviceConfigured()} /><PaymentRejectionForm evidenceId={file.id} reviewedVersion={order.version} reviewedSha256={file.sha256} requestKey={randomUUID()} /></> : null}</li>)}</ul> : <p>No proof submitted. This order is not in the payment review queue.</p>}
    <h2>Durable fulfilment</h2>{!order.operations.length && <p>No activation operation has been requested for this order.</p>}{order.operations.map(operation => <section key={operation.id}><p>{operation.kind.replaceAll("_", " ")} · {operation.state.replaceAll("_", " ")} · {operation.id}</p>{operation.state === "REVIEW_REQUIRED" && <FulfilmentRetry operationId={operation.id} userId={order.userId} version={operation.version} requestKey={randomUUID()} enabled={fulfilmentEnabled() && serviceConfigured()} />}</section>)}</section></>;
}
