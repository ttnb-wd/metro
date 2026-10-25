import Link from "next/link";
import { Suspense } from "react";
import { getWebsiteRepositories } from "@/server/website";
import { liveServiceStatus } from "@/server/vpn/live-status";
import { IssueForm, RetryForm } from "./commerce-forms";
import { ConnectPanel, ServiceRefreshButton } from "./connect-panel";
import { ServiceSubscriptionCard } from "./service-subscription-card";
import { ServiceLoading } from "./service-loading";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { requestTimestamp } from "@/server/commerce/time";

type Props = { detailed?: boolean; setupOnly?: boolean };
export function CustomerServices(props: Props) {
  // Stream the authoritative status independently; never send a cached key.
  return <Suspense fallback={<ServiceLoading />}><LoadedServices {...props} /></Suspense>;
}
async function LoadedServices({ detailed = false, setupOnly = false }: Props) {
  const now = await requestTimestamp();
  const repo = await getWebsiteRepositories();
  const [services, issues] = await Promise.all([repo.listServices(), detailed ? repo.listIssues() : []]);
  if (!services.length) return <section className="workspace-panel workspace-panel-padded service-empty"><p className="workspace-small-label">YOUR SERVICES</p><h2>No active service yet.</h2><p>Your subscription will appear here after payment review and verified activation.</p><Link className="text-link" href="/plans">Explore available plans →</Link></section>;
  return <section className="subscription-collection" aria-label="My services">{await Promise.all(services.map(async row => {
    const { entitlement, lastKnown, status, lastObservedAt } = await liveServiceStatus(row);
    return <ServiceSubscriptionCard key={row.id} id={row.id} name={row.packageName ?? "Secure Access"} data={entitlement ?? lastKnown} status={status} lastObservedAt={lastObservedAt} now={now}>
      {detailed || setupOnly ? <ConnectPanel key={`${row.id}:${entitlement?.version ?? row.version}`} serviceId={row.id} available={status.canConnect} unavailableReason={status.reasons.join(" ")} /> : <div className="subscription-actions"><Link href="/dashboard/secure-access" className="text-link">Manage Secure Access →</Link><ServiceRefreshButton /></div>}
      {detailed && <details className="subscription-support"><summary>Support &amp; troubleshooting</summary><p>Renewals keep your key when it still exists. Unused data carries forward. Deleted keys require support review.</p><IssueForm serviceId={row.id} />{issues.filter(issue => issue.serviceId === row.id).map(issue => <section className="support-history" key={issue.id} id={`issue-${issue.id}`}><h3>Support issue · {issue.state.replaceAll("_", " ")}</h3><ol>{issue.events.map(event => <li key={event.id}>{event.kind.replaceAll("_", " ")} · <time dateTime={event.createdAt.toISOString()}>{formatMyanmarTime(event.createdAt)}</time></li>)}</ol>{issue.state === "TROUBLESHOOTING" && <RetryForm key={`${issue.id}:${issue.version}`} issueId={issue.id} version={issue.version} attempts={issue.attempts} />}</section>)}</details>}
    </ServiceSubscriptionCard>;
  }))}</section>;
}
