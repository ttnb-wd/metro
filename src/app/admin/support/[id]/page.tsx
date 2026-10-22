import { formatMyanmarTime } from "@/lib/myanmar-time";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { adminPage, getAdminRepository } from "@/server/admin";
import { AdminHeading } from "@/components/admin/admin-views";
import { DiagnosisForm, ReplacementForm } from "@/components/admin/support-controls";
import { fulfilmentEnabled } from "@/server/commerce/config";
import { serviceConfigured } from "@/server/vpn/transport";
import { liveServiceStatus } from "@/server/vpn/live-status";
export default async function SupportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, repo = await adminPage(getAdminRepository), issue = await adminPage(() => repo.issue(id)), service = await adminPage(() => repo.service(issue.serviceId));
  const fresh = await liveServiceStatus({ userId: service.userId, externalId: service.entitlement.id, version: service.entitlement.version });
  return <><AdminHeading title="Connection report" description={`${service.customer.name} · ${service.customer.email}`} /><section className="admin-panel"><p>{issue.description}</p><p>Status: {issue.state} · Customer attempts: {issue.attempts}/3</p><Link className="text-link" href={`/admin/vpn/${issue.serviceId}`}>Open exact key, quota and expiry →</Link><ol>{issue.events.map(event => <li key={event.id}>{event.kind.replaceAll("_", " ")} · {formatMyanmarTime(event.createdAt)}</li>)}</ol>{["OPEN", "REVIEW_REQUIRED"].includes(issue.state) && <DiagnosisForm userId={issue.userId} issueId={issue.id} version={issue.version} requestKey={randomUUID()} />}{issue.state === "REPLACEMENT_APPROVED" && <ReplacementForm userId={issue.userId} serviceId={issue.serviceId} issueId={issue.id} expectedVersion={fresh.entitlement?.version ?? service.entitlement.version} requestKey={randomUUID()} enabled={fulfilmentEnabled() && serviceConfigured() && fresh.status.canConnect} />}</section></>;
}
