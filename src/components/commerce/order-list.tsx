import Link from "next/link";
import { getWebsiteRepositories } from "@/server/website";
import { customerOrderStatus } from "@/features/pricing/order-status";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { orderNumber } from "@/features/pricing/receipt";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { LiveRefresh } from "./live-refresh";
export async function CustomerOrders({ billing = false }: { billing?: boolean }) {
  const orders = await (await getWebsiteRepositories()).listOrders();
  return <section className="workspace-panel"><LiveRefresh /><h2>{billing ? "Payments and receipts" : "Order history"}</h2>{!orders.length ? <><p>No {billing ? "payment records" : "orders"} yet.</p><Link className="text-link" href="/plans">Explore available plans →</Link></> : <ul className="commerce-orders">{orders.map(row => <li key={row.id}><Link href={row.payment === "UNVERIFIED" && row.state === "AWAITING_PAYMENT" ? `/checkout?draft=${row.id}` : `/dashboard/orders/${row.id}`} className="text-link">{row.payment === "UNVERIFIED" ? "Resume checkout" : orderNumber(row.id)} →</Link><span>{formatWebsiteMmk(row.totalMmk.toFixed(0))}</span><p>{customerOrderStatus(row).title}</p><p>Payment: {row.payment.replaceAll("_", " ")} · VPN: {row.provisioning.replaceAll("_", " ")}</p><time dateTime={row.createdAt.toISOString()}>{formatMyanmarTime(row.createdAt)}</time>{row.payment !== "UNVERIFIED" && <div className="workspace-access-actions"><Link className="text-link" href={`/dashboard/orders/${row.id}/receipt`}>View / print receipt →</Link><a className="text-link" href={`/api/orders/${row.id}/receipt?download=1`}>Download receipt (.html)</a></div>}</li>)}</ul>}</section>;
}
