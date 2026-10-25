import Link from "next/link";
import type { ReactNode } from "react";
import type { Entitlement } from "@/server/vpn/contracts";
import { formatRemaining, type serviceStatus } from "@/features/workspace/service-status";
import { usagePresentation } from "@/features/workspace/usage-presentation";
import { formatMyanmarTime, MYANMAR_TIME_ZONE } from "@/lib/myanmar-time";

const labels = { ACTIVE: "Active", LOW_DATA: "Low data", DATA_EXHAUSTED: "Data exhausted", EXPIRED: "Expired", BOTH_EXHAUSTED: "Expired · data exhausted", PAUSED: "Suspended", STALE: "Usage delayed", UNAVAILABLE: "Status unavailable" };
const date = new Intl.DateTimeFormat("en-GB", { timeZone: MYANMAR_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: MYANMAR_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export function ServiceSubscriptionCard({ id, name, data, status, lastObservedAt, now, children }: {
  id: string; name: string; data: Entitlement | null; status: ReturnType<typeof serviceStatus>; lastObservedAt: string | null; now: number; children?: ReactNode;
}) {
  const usage = usagePresentation(status.usedBytes, data?.totalBytes ?? null);
  const days = data ? Math.max(0, Math.ceil((Date.parse(data.expiresAt) - now) / 86_400_000)) : null;
  return <article className="subscription-card" aria-labelledby={`service-title-${id}`}>
    <header className="subscription-heading"><p className="workspace-small-label">SECURE ACCESS / YOUR SUBSCRIPTION</p><h2 id={`service-title-${id}`}>{name}</h2><span className="subscription-status" data-condition={status.condition}>{labels[status.condition]}</span></header>
    <div className="subscription-notice" role="status">{status.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
    <dl className="subscription-stats">
      <div><dt>{status.usageKnown ? "Total allowance" : "Recorded allowance"}</dt><dd data-unavailable={!data}>{data ? formatRemaining(data.totalBytes) : "Unavailable"}</dd><span>Full purchased period</span></div>
      <div><dt>Data used</dt><dd data-unavailable={status.usedBytes === null}>{status.usedBytes !== null ? formatRemaining(status.usedBytes) : "Unavailable"}</dd><span>Cumulative usage</span></div>
      <div className="subscription-remaining"><dt>Data remaining</dt><dd data-unavailable={status.remainingBytes === null}>{status.remainingBytes !== null ? formatRemaining(status.remainingBytes) : "Unavailable"}</dd><span>No monthly quota reset</span></div>
    </dl>
    <div className="subscription-usage">{usage && data ? <><div><label htmlFor={`usage-${id}`}>Allowance used</label><span>{usage.label}</span></div><progress id={`usage-${id}`} value={usage.value} max={100} aria-valuetext={`${formatRemaining(status.usedBytes!)} used of ${formatRemaining(data.totalBytes)}`} /></> : <p>Usage cannot be verified right now. No zero-consumption estimate is shown.</p>}</div>
    <dl className="subscription-lifecycle"><div><dt>{status.usageKnown ? "Days remaining" : "Recorded time remaining"}</dt><dd>{days ?? "Unavailable"}{days !== null && <small> days</small>}</dd></div><div><dt>{status.usageKnown ? "Expires" : "Last recorded expiry"}</dt><dd>{data ? <time dateTime={data.expiresAt} aria-label={formatMyanmarTime(data.expiresAt)}><span>{date.format(new Date(data.expiresAt))}</span><span>{time.format(new Date(data.expiresAt))}</span><small>Myanmar time · UTC+06:30</small></time> : "Unavailable"}</dd></div></dl>
    <footer className="subscription-footer"><p>{status.usageKnown ? "Usage verified" : "Last verified observation"}<br />{lastObservedAt ? <time dateTime={lastObservedAt}>{formatMyanmarTime(lastObservedAt)}</time> : "No verified observation available"}</p><Link href="/plans" className="text-link">{status.topUp && status.renew ? "Top up & renew" : status.topUp ? "Top up data" : status.renew ? "Renew subscription" : "Renew / top up"} →</Link></footer>
    {children}
  </article>;
}
