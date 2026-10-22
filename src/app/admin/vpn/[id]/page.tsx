import { formatMyanmarTime } from "@/lib/myanmar-time";
import { adminPage, getAdminRepository } from "@/server/admin";
import { AdminHeading } from "@/components/admin/admin-views";
import { ConnectPanel } from "@/components/commerce/connect-panel";
import { liveServiceStatus } from "@/server/vpn/live-status";
import { formatRemaining } from "@/features/workspace/service-status";
export default async function ServiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, service = await adminPage(async () => (await getAdminRepository()).service(id));
  const { entitlement: data, status } = await liveServiceStatus({ userId: service.userId, externalId: service.entitlement.id, version: service.entitlement.version });
  return <><AdminHeading title="Secure Access entitlement" description={`${service.customer.name} · ${service.customer.email}`} /><section className="admin-panel"><dl className="admin-details"><div><dt>Plan</dt><dd>{service.packageName}</dd></div><div><dt>Exact key ID</dt><dd>{data?.keyId ?? "Unavailable"}</dd></div><div><dt>Status</dt><dd>{status.condition.replaceAll("_", " ")}</dd></div><div><dt>Total / Used / Remaining</dt><dd>{data && status.usageKnown ? `${formatRemaining(data.totalBytes)} / ${formatRemaining(data.usedBytes)} / ${formatRemaining(data.remainingBytes)}` : "Unavailable"}</dd></div><div><dt>Expiry</dt><dd>{data ? formatMyanmarTime(data.expiresAt) : "Unavailable"}</dd></div></dl>{status.reasons.map(reason => <p key={reason}>{reason}</p>)}<ConnectPanel key={`${service.id}:${data?.version ?? service.entitlement.version}`} serviceId={service.id} admin available={status.canConnect} unavailableReason={status.reasons.join(" ")} /></section></>;
}
