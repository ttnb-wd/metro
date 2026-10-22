import Link from "next/link";
import { getWebsiteRepositories } from "@/server/website";
import { liveServiceStatus } from "@/server/vpn/live-status";
import { IssueForm, RetryForm } from "./commerce-forms";
import { ConnectPanel, ServiceRefreshButton } from "./connect-panel";
import { formatRemaining } from "@/features/workspace/service-status";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { requestTimestamp } from "@/server/commerce/time";

export async function CustomerServices({ detailed = false, setupOnly = false }: { detailed?: boolean; setupOnly?: boolean }) {
  const now = await requestTimestamp();
  const repo = await getWebsiteRepositories(), [services, issues] = await Promise.all([repo.listServices(), detailed ? repo.listIssues() : []]);
  return <section className="workspace-panel"><h2>My services</h2>{!services.length ? <><p>No active service. Your purchased service will appear after payment review and successful activation.</p><Link className="text-link" href="/plans">Explore available plans →</Link></> : await Promise.all(services.map(async row => {
    const { entitlement: data, status, lastObservedAt } = await liveServiceStatus(row);
    const days = data && status.usageKnown ? Math.max(0, Math.ceil((Date.parse(data.expiresAt) - now) / 86_400_000)) : null;
    const used = data && status.usageKnown ? BigInt(data.usedBytes) : null, total = data ? BigInt(data.totalBytes) : null;
    const percent = used !== null && total !== null ? Number((used > total ? total : used) * BigInt(10000) / total) / 100 : null;
    return <article key={row.id} className="commerce-service">
      <h3>{row.packageName ?? "Secure Access"}</h3><p className="service-condition">{status.condition.replaceAll("_", " ")}</p>
      <div role="status">{status.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
      <dl className="workspace-service-facts"><div><dt>Days remaining</dt><dd>{days ?? "Unavailable"}</dd></div><div><dt>{status.usageKnown ? "Expiry" : "Last recorded expiry"}</dt><dd>{data ? <time dateTime={data.expiresAt}>{formatMyanmarTime(data.expiresAt)}</time> : "Unavailable"}</dd></div><div><dt>{status.usageKnown ? "Total allowance" : "Recorded allowance"}</dt><dd>{data ? formatRemaining(data.totalBytes) : "Unavailable"}</dd></div><div><dt>Data used</dt><dd>{status.usedBytes !== null ? formatRemaining(status.usedBytes) : "Unavailable"}</dd></div><div><dt>Data remaining</dt><dd>{status.remainingBytes !== null ? formatRemaining(status.remainingBytes) : "Unavailable"}</dd></div></dl>
      {percent !== null && data && <div className="service-usage"><label htmlFor={`usage-${row.id}`}>Data allowance used · {percent.toFixed(2)}%</label><progress id={`usage-${row.id}`} max={100} value={percent} aria-valuetext={`${formatRemaining(data.usedBytes)} used of ${formatRemaining(data.totalBytes)}`} /></div>}
      <p className="workspace-small-label">Last usage observation: {lastObservedAt ? <time dateTime={lastObservedAt}>{formatMyanmarTime(lastObservedAt)}</time> : "Unavailable · no verified observation"}</p>
      <div className="workspace-access-actions">{status.topUp && <Link href="/plans" className="text-link">Top up data →</Link>}{status.renew && <Link href="/plans" className="text-link">Renew subscription →</Link>}{!status.topUp && !status.renew && <Link href="/plans" className="text-link">Renew / top up →</Link>}</div>
      {detailed || setupOnly ? <ConnectPanel key={`${row.id}:${data?.version ?? row.version}`} serviceId={row.id} available={status.canConnect} unavailableReason={status.reasons.join(" ")} /> : <><Link href="/dashboard/secure-access" className="text-link">Manage Secure Access →</Link><ServiceRefreshButton /></>}
      {detailed && <><p>Renewals keep your key when it still exists. Unused data carries forward. Deleted keys require support review.</p><IssueForm serviceId={row.id} />{issues.filter(issue => issue.serviceId === row.id).map(issue => <section key={issue.id} id={`issue-${issue.id}`}><h4>Support issue · {issue.state.replaceAll("_", " ")}</h4><ol>{issue.events.map(event => <li key={event.id}>{event.kind.replaceAll("_", " ")} · <time dateTime={event.createdAt.toISOString()}>{formatMyanmarTime(event.createdAt)}</time></li>)}</ol>{issue.state === "TROUBLESHOOTING" && <RetryForm key={`${issue.id}:${issue.version}`} issueId={issue.id} version={issue.version} attempts={issue.attempts} />}</section>)}</>}
    </article>;
  }))}</section>;
}
