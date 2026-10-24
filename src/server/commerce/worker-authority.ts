import "server-only";
import type { Prisma, WebsiteOperation } from "../db/generated/client";
import { entitlementSchema } from "../vpn/contracts";

export class WorkerReviewError extends Error {
  constructor(readonly reason: "AUTHORIZATION_REVIEW_REQUIRED" | "RECEIPT_REVIEW_REQUIRED" | "OPERATION_STATE_CHANGED") { super(reason); }
}
const same = (a: unknown, b: unknown): boolean => {
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([x], [y]) => x.localeCompare(y))) : entry);
  return canonical(a) === canonical(b);
};
/** Recheck durable human authorization before remote effects AND before commit.
 * A queue item or browser-supplied CONFIRMED field alone is never authority. */
export async function assertDispatchAuthority(tx: Prisma.TransactionClient, op: WebsiteOperation) {
  const deny = (): never => { throw new WorkerReviewError("AUTHORIZATION_REVIEW_REQUIRED"); };
  const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
  const user = await tx.user.findUnique({ where: { id: op.userId }, select: { emailVerified: true } });
  if (!binding || !user?.emailVerified) deny();
  if (!await tx.user.findFirst({ where: { id: binding!.userId, emailVerified: true }, select: { id: true } })) deny();
  if (op.kind === "PROVISION") {
    if (!op.orderId || op.serviceId || op.issueId || op.resourceKey !== op.orderId) deny();
    const order = await tx.websiteOrder.findFirst({ where: { id: op.orderId!, userId: op.userId } });
    if (!order || order.payment !== "CONFIRMED" || order.state !== "FULFILMENT_PENDING" || !same(order.quoteSnapshot, op.frozenSnapshot)) deny();
    const decisions = await tx.paymentDecision.findMany({ where: { orderId: op.orderId!, userId: op.userId, decision: "APPROVED" }, take: 2,
      select: { id: true, ownerId: true, evidenceId: true, amountMmk: true, reasonCode: true } });
    const decision = decisions[0];
    if (decisions.length !== 1 || decision.ownerId !== binding!.userId || decision.reasonCode !== "PAYMENT_MATCHED" || !decision.amountMmk.equals(order!.totalMmk)) deny();
    const evidence = await tx.paymentEvidence.findFirst({ where: { id: decision.evidenceId, orderId: op.orderId!, userId: op.userId }, select: { id: true } });
    if (!evidence || !await tx.websiteAuditEvent.findFirst({ where: { actorId: binding!.userId, targetUserId: op.userId, resourceId: op.orderId!, action: "PAYMENT_DECISION", reasonCode: "PAYMENT_MATCHED", outcome: "SUCCESS" }, select: { id: true } })) deny();
  } else if (op.kind === "REPLACEMENT") {
    if (op.orderId || !op.serviceId || !op.issueId) deny();
    const frozen = entitlementSchema.safeParse(op.frozenSnapshot);
    const issue = await tx.supportIssue.findFirst({ where: { id: op.issueId!, userId: op.userId, serviceId: op.serviceId! } });
    const service = await tx.websiteServiceReference.findFirst({ where: { id: op.serviceId!, userId: op.userId } });
    if (!frozen.success || !issue || issue.state !== "REPLACEMENT_APPROVED" || !service || service.externalId !== frozen.data.id || frozen.data.owner.subject !== op.userId || op.expectedVersion !== frozen.data.version || op.resourceKey !== `${op.serviceId}:${op.expectedVersion}`) deny();
    const diagnosis = await tx.supportIssueEvent.findFirst({ where: { issueId: op.issueId!, userId: op.userId, kind: { in: ["ADMIN_TEST_FAILED", "ADMIN_TEST_SUCCEEDED"] } }, orderBy: { version: "desc" }, select: { actorId: true, kind: true } });
    if (diagnosis?.actorId !== binding!.userId || diagnosis.kind !== "ADMIN_TEST_FAILED" || !await tx.websiteAuditEvent.findFirst({ where: { actorId: binding!.userId, targetUserId: op.userId, resourceId: op.serviceId!, action: "REPLACEMENT_REQUEST", reasonCode: "VERIFIED_KEY_FAILURE", outcome: "SUCCESS" }, select: { id: true } })) deny();
  } else deny();
}
