import { formatWebsiteMmk } from "./catalog";
import { customerOrderStatus } from "./order-status";
import { formatMyanmarTime } from "@/lib/myanmar-time";

export const orderNumber = (id: string) => `METRO-${id.toUpperCase()}`;
export type OrderReceipt = {
  id: string; customer: { name: string; email: string }; payment: string; provisioning: string; state: string;
  plan: { packageName: string; durationDays: number; totalDataGb: number; monthlyPriceMmk?: string; regularMmk: string; savedMmk: string; discountPercent: number; totalMmk: string; paymentMethod: { name: string; accountName: string; accountNumber: string } };
  createdAt: string; submittedAt: string; latestSubmissionAt: string; approvedAt: string | null; activationRecordedAt: string | null;
  currentExpiry: string | null; expiryObservedAt: string | null;
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export function receiptPaymentLabel(payment: string): string {
  return payment === "CONFIRMED" ? "Payment Confirmed" : payment === "UNDER_REVIEW" ? "Payment Under Review" : payment === "REJECTED" ? "Payment Proof Rejected" : "Payment Not Confirmed";
}
export function receiptSections(receipt: OrderReceipt) {
  const plan = receipt.plan;
  return [
    { title: "Order & customer", rows: [["Order number", orderNumber(receipt.id)], ["Customer", receipt.customer.name], ["Email", receipt.customer.email], ["Package", plan.packageName], ["Purchased allowance", `${plan.totalDataGb} GB · no monthly reset`], ["Duration", `${plan.durationDays} days`]] },
    { title: "Agreed price", rows: [["Base price / 30 days", plan.monthlyPriceMmk ? formatWebsiteMmk(plan.monthlyPriceMmk) : "Not recorded"], ["Regular price", formatWebsiteMmk(plan.regularMmk)], ["Discount", `${plan.discountPercent}%`], ["Amount saved", formatWebsiteMmk(plan.savedMmk)], ["Final amount", formatWebsiteMmk(plan.totalMmk)], ["Payment method", plan.paymentMethod.name]] },
    { title: "Status & dates", rows: [["Payment", receiptPaymentLabel(receipt.payment)], ["VPN fulfilment", customerOrderStatus(receipt).title], ["Order created", formatMyanmarTime(receipt.createdAt)], ["Proof submitted", formatMyanmarTime(receipt.submittedAt)], ...(receipt.latestSubmissionAt !== receipt.submittedAt ? [["Latest proof submission", formatMyanmarTime(receipt.latestSubmissionAt)]] : []), ["Payment approved", formatMyanmarTime(receipt.approvedAt)], ["Activation recorded", formatMyanmarTime(receipt.activationRecordedAt)], ["Last recorded subscription expiry", formatMyanmarTime(receipt.currentExpiry)], ...(receipt.expiryObservedAt ? [["Subscription observed", formatMyanmarTime(receipt.expiryObservedAt)]] : [])] },
  ];
}

// Every database value is escaped. This same body is used by the authenticated
// receipt screen and its self-contained HTML download; no credentials or proof.
export function receiptBody(receipt: OrderReceipt): string {
  return `<article class="metro-receipt"><header class="receipt-brand"><strong>metro<span>.</span></strong><div><h1>Metro order receipt</h1><p>${escape(receiptPaymentLabel(receipt.payment))}</p></div></header>${receiptSections(receipt).map(section => `<section><h2>${section.title}</h2><dl>${section.rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl></section>`).join("")}<footer><p>This receipt is issued by Metro. It is not a KBZPay-issued receipt.</p><p>Submitting proof does not confirm payment or activate VPN access. Payment approval and VPN activation are separate steps.</p>${receipt.currentExpiry ? "<p>Recorded expiry reflects the observed subscription and may include later renewals; the agreed price above remains unchanged.</p>" : ""}<p>All dates are displayed in Myanmar time (Asia/Yangon). Missing historical dates are not inferred.</p></footer></article>`;
}
export const receiptStyles = `.metro-receipt{box-sizing:border-box;max-width:820px;margin:auto;padding:32px;background:#fff;color:#10243d;border:1px solid #dbe5ee;border-radius:16px;font:13px/1.65 Inter,Arial,sans-serif;overflow-wrap:anywhere}.metro-receipt *{box-sizing:border-box}.receipt-brand{display:flex;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:2px solid #0877d1}.receipt-brand>strong{font-size:32px;letter-spacing:-2px}.receipt-brand>strong span{color:#008cad}.receipt-brand h1{font-size:20px;margin:0}.receipt-brand p{margin:4px 0 0;color:#075cb5;font-weight:600}.metro-receipt section{margin-top:22px;break-inside:avoid}.metro-receipt h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px;color:#075cb5}.metro-receipt dl{margin:0}.metro-receipt dl>div{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,2fr);gap:16px;padding:7px 0;border-bottom:1px solid #edf1f6}.metro-receipt dt{color:#53647b}.metro-receipt dd{margin:0;font-weight:500}.metro-receipt footer{margin-top:24px;font-size:11px;color:#53647b}.metro-receipt footer p{margin:6px 0}@media(max-width:500px){.metro-receipt{padding:18px}.receipt-brand{flex-direction:column;gap:8px}.metro-receipt dl>div{grid-template-columns:1fr;gap:2px}}@media print{.metro-receipt{max-width:none;border:0;border-radius:0;padding:0;font-size:11px}.metro-receipt section{margin-top:14px}.metro-receipt dl>div{padding:4px 0}.receipt-brand{padding-bottom:12px}body{margin:18mm;background:#fff}}`;
export function receiptDocument(receipt: OrderReceipt): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(orderNumber(receipt.id))} · Metro receipt</title><style>${receiptStyles}</style></head><body>${receiptBody(receipt)}</body></html>`;
}
