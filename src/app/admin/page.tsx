import Link from "next/link";
import { LiveRefresh } from "@/components/commerce/live-refresh";
import { fulfilmentEnabled } from "@/server/commerce/config";
import { serviceConfigured } from "@/server/vpn/transport";
import { ArrowUpRight } from "lucide-react";
import { AdminHeading, AdminNotice } from "@/components/admin/admin-views";
import { adminPage, getAdminRepository } from "@/server/admin";

export default async function AdminOverview() {
  const enabled = fulfilmentEnabled() && serviceConfigured();
  const data = await adminPage(async () => (await getAdminRepository()).overview());
  return <><LiveRefresh /><AdminHeading eyebrow="OWNER CONSOLE" title="A clear view. A steady hand." description="Manage Metro’s website customers, commerce and support from one place." />
    <div className="admin-summary"><div><span>Website customers</span><strong>{data.customers}</strong><Link href="/admin/customers">View accounts <ArrowUpRight size={14} aria-hidden="true" /></Link></div><div><span>Orders recorded</span><strong>{data.orders}</strong><Link href="/admin/orders">Open order history <ArrowUpRight size={14} aria-hidden="true" /></Link></div><div><span>Active subscriptions</span><strong>{data.activeServices}</strong><Link href="/admin/vpn">View recorded services <ArrowUpRight size={14} aria-hidden="true" /></Link></div></div>
    <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">YOUR ATTENTION</p><h2>The work ahead.</h2><p>Counts below come from durable website records.</p></div></div><div className="admin-attention-list">{[{ href: "/admin/payments", name: "Payment evidence awaiting review", count: data.pendingPayments, note: "Explicit OWNER decisions only" }, { href: "/admin/support", name: "Open customer issues", count: data.openIssues, note: "Support and retry history" }, { href: "/admin/notifications", name: "Events awaiting delivery", count: data.pendingEvents, note: "Open the event to review its payment, issue or operation" }].map(item => <Link href={item.href} key={item.href}><div><strong>{item.name}</strong><p>{item.note}</p></div><span>{item.count}</span><ArrowUpRight size={18} aria-hidden="true" /></Link>)}</div></section>
    <div className="admin-overview-grid"><Link href="/admin/plans" className="admin-feature-link"><span className="eyebrow">WEBSITE COMMERCE</span><h2>Pricing, under your control.</h2><p>Independent package prices and duration discounts, published as immutable versions.</p><span>Manage website pricing <ArrowUpRight size={16} aria-hidden="true" /></span></Link><AdminNotice title={enabled ? "VPN fulfilment enabled" : "VPN fulfilment paused"}>{enabled ? "Approved payments enter the fulfilment queue. Credentials are released after finite quota and expiry checks. Service snapshots refresh in the background." : "Customers can submit payment evidence for review. Payment approval and VPN activation remain paused. Existing entitlement enforcement continues on the VPN backend."}</AdminNotice></div>
  </>;
}
