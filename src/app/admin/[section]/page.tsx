import { LiveRefresh } from "@/components/commerce/live-refresh";
import { fulfilmentEnabled } from "@/server/commerce/config";
import { CatalogImport } from "@/components/admin/catalog-import";
import { serviceConfigured } from "@/server/vpn/transport";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { adminSections } from "@/config/admin";
import { AdminHeading, AdminNotice, AdminRecords } from "@/components/admin/admin-views";
import { PricingEditor } from "@/components/admin/pricing-editor";
import { ProfileNameForm } from "@/components/forms/profile-name-form";
import { adminPage, getAdminRepository } from "@/server/admin";
import type { RecordSection } from "@/server/admin/repository";
import { getPricingRepository } from "@/server/pricing";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { NotificationInbox } from "@/components/dashboard/notification-inbox";
import { NotificationDeliveryReview } from "@/components/admin/notification-delivery";

export default async function AdminSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { section } = await params;
  const definition = adminSections.find(item => item.slug === section && item.slug !== "");
  if (!definition) notFound();
  const repository = await adminPage(getAdminRepository);
  let content: React.ReactNode;
  if (section === "plans" || section === "discounts") {
    const state = await adminPage(async () => (await getPricingRepository()).readForOwner());
    content = <>{state.status === "UNPUBLISHED" && ! (section === "discounts") && <CatalogImport requestKey={randomUUID()} available={serviceConfigured()} />}<PricingEditor key={state.status === "READY" ? state.release.version : state.status} initial={state} requestKey={randomUUID()} discountsOnly={section === "discounts"} /></>;
  } else if (section === "settings") {
    const account = await adminPage(() => repository.identity());
    const pricing = await adminPage(async () => (await getPricingRepository()).readForOwner());
    content = <><section className="admin-panel"><div className="admin-panel-heading"><div><h2>Your OWNER account</h2><p>Authorization is bound to your immutable website user ID.</p></div><span className="admin-status">Verified OWNER</span></div><dl className="admin-details"><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>Website user ID</dt><dd>{account.id}</dd></div><div><dt>Website pricing</dt><dd>{pricing.status === "READY" ? `Published version ${pricing.release.version}` : pricing.status === "MIGRATION_PENDING" ? "Migration and runtime grants pending" : pricing.status === "UNPUBLISHED" ? "Ready for first publication" : "Unavailable"}</dd></div><div><dt>VPN fulfilment</dt><dd>{fulfilmentEnabled() ? "Enabled · OWNER payment review required" : "Paused · production worker activation gate is closed"}</dd></div></dl><ProfileNameForm name={account.name} /></section><AdminNotice title="Sensitive actions require a recent login">Sign out and sign in again before publishing prices or recording payment decisions. The five-minute requirement uses your actual database session creation time.</AdminNotice></>;
  } else if (section === "reports") {
    const data = await adminPage(() => repository.overview());
    const report = await adminPage(() => repository.reports());
    content = <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Website records, today</h2><p>Current totals across real records. Confirmed order amounts are not a settlement or revenue report.</p></div></div><dl className="admin-details"><div><dt>Customers</dt><dd>{data.customers}</dd></div><div><dt>Orders</dt><dd>{data.orders}</dd></div><div><dt>Confirmed order amounts</dt><dd>{formatWebsiteMmk(data.confirmedMmk)}</dd></div><div><dt>Payments under review</dt><dd>{data.pendingPayments}</dd></div><div><dt>Service references</dt><dd>{data.services}</dd></div><div><dt>Operations queued or needing review</dt><dd>{data.queued}</dd></div></dl><p className="admin-small-note">Recorded usage: {report.usedGb} GB. Active, unexpired recorded services: {report.active}. These snapshots are not a payment settlement report.</p>{report.packages.length > 0 && <div><h3>Confirmed sales by package</h3><ul>{report.packages.map(item => <li key={item.packageName}>{item.packageName} · {item.orders} orders · {formatWebsiteMmk(item.total)}</li>)}</ul></div>}</section>;
  } else {
    const query = await searchParams;
    const page = query.page && /^[1-9][0-9]{0,3}$/.test(query.page) ? Number(query.page) : 1;
    const data = await adminPage(() => repository.records(section as RecordSection, { q: typeof query.q === "string" ? query.q.slice(0, 80) : "", page }));
    content = <>{section === "vpn" && <AdminNotice title="Recorded references · Live controls unavailable">Quota, usage and expiry are shown only from validated backend snapshots, with their capture time. Open a service to securely reveal a key when the backend is configured.</AdminNotice>}{section === "payments" && <AdminNotice title="Payment evidence review">Open each screenshot securely and verify the actual receiving account and order amount before approving. Verified approval queues the existing automatic VPN fulfilment flow when enabled.</AdminNotice>}{section === "support" && <AdminNotice title="Troubleshooting history">Retry history is recorded per customer issue. Open an issue to record your manual connection test and manage guided retries. Replacement remains gated until the existing VPN engine is activated.</AdminNotice>}<AdminRecords data={data} title={definition.label} /></>;
  }
  return <><LiveRefresh /><AdminHeading title={definition.label} description={definition.description} />{section === "notifications" && <><NotificationInbox /><NotificationDeliveryReview /></>}{content}</>;
}
