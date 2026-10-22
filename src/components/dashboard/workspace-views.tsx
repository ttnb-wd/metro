import { formatMyanmarTime } from "@/lib/myanmar-time";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { services } from "@/config/services";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { LogoutButton } from "@/components/forms/logout-button";
import { ProfileNameForm } from "@/components/forms/profile-name-form";
import { PageHeading, SectionHeader, EmptyState, QuickActionCard, ServiceOverviewCard, WorkspaceNote } from "@/components/dashboard/workspace-components";

export function OverviewView({ name }: { name: string }) {
  return <>
    <PageHeading eyebrow="OVERVIEW" title={<>Welcome, <span>{name}</span>.</>} description="A little more room for your digital life. This is your home for Metro services and your account." />
    <div className="workspace-overview-grid"><section className="workspace-panel">
      <SectionHeader title="My services" action={<Link href="/dashboard/services" className="workspace-inline-link">View collection<ArrowUpRight size={14} aria-hidden="true" /></Link>} />
      <EmptyState compact title="Your collection starts here." description="No services to show yet. Your activated services will live here when service management is connected." href="/services" action="Explore services" />
    </section><div className="workspace-discovery"><p className="workspace-small-label">DISCOVER ON METRO</p>{services.slice(0, 1).map(service => <ServiceOverviewCard key={service.id} service={service} />)}</div></div>
    <section className="workspace-section"><SectionHeader title="Find your next step" /><div className="workspace-quick-grid">
      <QuickActionCard label="EXPLORE" title="Meet your digital essentials." description="Get to know Metro’s available services and how they work." href="/services" />
      <QuickActionCard label="MAKE IT YOURS" title="Find a plan that fits." description="Explore data packages and flexible durations for Secure Access." href="/plans" />
    </div></section>
    <WorkspaceNote>Your account is ready. Service activation, ordering and payments are not connected yet.</WorkspaceNote>
  </>;
}

export function ServicesView() {
  return <>
    <PageHeading eyebrow="YOUR COLLECTION" title="My services" description="One home for the services you choose. Keep the essentials close, with space for what comes next." />
    <section className="workspace-panel"><SectionHeader title="Your collection" /><EmptyState title="Make space for something useful." description="No purchased services are available to display. Purchasing and service syncing are not connected yet." href="/services" action="Discover available services" /></section>
    <section className="workspace-section"><SectionHeader title="Available to explore" description="Get to know what Metro offers today." /><div className="workspace-service-grid">{services.map(service => <ServiceOverviewCard key={service.id} service={service} />)}</div></section>
  </>;
}

export function SecureAccessView() {
  return <>
    <PageHeading eyebrow="SERVICE WORKSPACE" title="Secure Access" description="Your subscription, connection details and usage will come together here when your service is linked." />
    <section className="workspace-access-panel"><div className="workspace-access-copy"><span className="workspace-status">No active service</span><h2>A place for your connection.</h2><p>Secure Access subscriptions are not connected to this workspace yet. No access key or working connection is available.</p><div className="workspace-access-actions"><Button asChild><Link href="/services/secure-access">About Secure Access<ArrowUpRight aria-hidden="true" /></Link></Button><Button variant="secondary" asChild><Link href="/plans">Explore plans</Link></Button></div></div><div className="workspace-access-mark" aria-hidden="true"><span>M</span><div /><div /></div></section>
    <section className="workspace-panel workspace-section"><SectionHeader title="Service details" description="These details will appear after a real service is linked." />
      <dl className="workspace-service-facts"><div><dt>Subscription</dt><dd>Not linked<p>No plan activated</p></dd></div><div><dt>Expiry</dt><dd aria-label="Not available">—<p>After activation</p></dd></div><div><dt>Data allowance</dt><dd aria-label="Not available">—<p>Based on your plan</p></dd></div><div><dt>Usage</dt><dd>Unavailable<p>Not connected</p></dd></div></dl>
    </section><WorkspaceNote>Connection, renewal and access-key actions will appear only when service integration is available.</WorkspaceNote>
  </>;
}

export function OrdersView() {
  return <>
    <PageHeading eyebrow="PURCHASES" title="Orders" description="An orderly home for your purchases and their details. Everything you need, without the search." />
    <section className="workspace-panel"><SectionHeader title="Order history" description="Your website orders will appear here." />
      <div className="workspace-record-labels" aria-hidden="true"><span>Order</span><span>Service</span><span>Date</span><span>Status</span></div>
      <EmptyState title="A fresh start." description="There are no website orders to display. Ordering is not connected yet, so no purchase can be made from this workspace." href="/services" action="Explore services" />
    </section><WorkspaceNote>Exploring services or plans does not create an order.</WorkspaceNote>
  </>;
}

export function BillingView() {
  return <>
    <PageHeading eyebrow="PAYMENTS & RECEIPTS" title="Billing" description="A clear place for payment records, receipts and the details behind them." />
    <div className="workspace-billing-grid"><section className="workspace-panel"><SectionHeader title="Receipts & invoices" />
      <EmptyState compact title="Nothing to file just yet." description="Payment processing is not connected. No invoices, receipts or payment confirmations are available to display." />
    </section><aside className="workspace-billing-note"><span className="workspace-small-label">GOOD TO KNOW</span><h2>A clear record, when it’s ready.</h2><p>Receipts will live alongside your completed orders once payments are available.</p><div className="workspace-billing-rule" /><h3>Payment methods</h3><p>No payment method is connected or collected in this workspace.</p><Link href="/plans" className="workspace-inline-link">Explore plan information<ArrowUpRight size={15} aria-hidden="true" /></Link></aside></div>
  </>;
}

export function SettingsView({ account }: { account: { name: string; email: string; createdAt: Date | string } }) {
  const joined = new Date(account.createdAt);
  const joinedLabel = formatMyanmarTime(joined);
  return <>
    <PageHeading eyebrow="YOUR ACCOUNT" title="Settings" description="The details that make this space yours. Manage your appearance and your current session." />
    <section className="workspace-panel"><SectionHeader title="Account details" description="Your authenticated Metro website identity." /><dl className="workspace-account-details">
      <div><dt>Name</dt><dd>{account.name}</dd></div><div><dt>Email address</dt><dd>{account.email}</dd></div><div><dt>Sign-in method</dt><dd>Email & password</dd></div><div><dt>Member since</dt><dd><time dateTime={joined.toISOString()}>{joinedLabel}</time></dd></div>
    </dl><ProfileNameForm name={account.name} /><p className="workspace-panel-footnote">Email and password changes are not available yet.</p></section>
    <section className="workspace-panel workspace-section"><div className="workspace-settings-row"><div><h2>Appearance</h2><p>Light or dark. Make Metro comfortable for you on this browser.</p></div><ThemeToggle /></div></section>
    <section className="workspace-panel workspace-section"><div className="workspace-settings-row"><div><h2>Your session</h2><p>End your current session on this browser when you’re finished.</p></div><LogoutButton /></div></section>
  </>;
}
