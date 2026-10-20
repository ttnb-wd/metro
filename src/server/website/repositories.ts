import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "../db/generated/client";
import { authenticatedSession, requireOwnerSession, readWebsiteSession, FoundationError, type SessionReader, type VerifiedSession } from "../owner/authorization";
import { quoteSchema, entitlementSchema, WEBSITE_ISSUER } from "../vpn/contracts";
import { assertTransition } from "../vpn/states";

type Tx = Prisma.TransactionClient;
const uuid = z.uuid();
const metaSchema = z.strictObject({ requestId: uuid, idempotencyKey: uuid });
export type RequestMetadata = z.infer<typeof metaSchema>;
const text = z.string().trim().min(1).max(1000).refine(value => !/(ss:\/\/|postgres(?:ql)?:\/\/|bearer\s)/i.test(value));
const evidenceSchema = z.strictObject({ orderId: uuid, storageRef: uuid, sha256: z.string().regex(/^[a-f0-9]{64}$/), mediaType: z.enum(["image/png", "image/jpeg", "application/pdf"]), bytes: z.number().int().min(1).max(10485760) });
const ownerTarget = { userId: uuid };
const paymentSchema = z.strictObject({ ...ownerTarget, orderId: uuid, evidenceId: uuid, verificationRef: uuid,
  amountMmk: z.string().regex(/^[1-9][0-9]{0,29}$/), decision: z.enum(["APPROVED", "REJECTED"]) });
const issueInput = z.strictObject({ serviceId: uuid, category: z.enum(["CANNOT_CONNECT", "UNSTABLE_CONNECTION"]), description: text });
const diagnosisInput = z.strictObject({ ...ownerTarget, issueId: uuid, version: z.number().int().nonnegative(), result: z.enum(["SUCCEEDED", "FAILED"]) });
const retryInput = z.strictObject({ issueId: uuid, version: z.number().int().nonnegative(), expectedAttempt: z.number().int().min(0).max(2), result: z.enum(["SUCCEEDED", "FAILED"]) });
const replacementInput = z.strictObject({ ...ownerTarget, serviceId: uuid, issueId: uuid, expectedVersion: z.number().int().nonnegative() });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input); if (!result.success) throw new FoundationError("INVALID_REQUEST"); return result.data;
}
function conflict(): never { throw new FoundationError("CONFLICT"); }
function found<T>(row: T | null): T { if (!row) throw new FoundationError("NOT_FOUND"); return row; }
function errorCode(error: unknown): string | undefined { return error && typeof error === "object" && "code" in error ? String(error.code) : undefined; }
function safeError(error: unknown): FoundationError {
  return error instanceof FoundationError ? error : new FoundationError(["P2002", "P2003", "P2034"].includes(errorCode(error) ?? "") ? "CONFLICT" : "UNAVAILABLE");
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}

// Construct through the verified disposable adapter or gated production factory.
export function buildRepositories(db: PrismaClient, readSession: SessionReader = readWebsiteSession) {
  async function transaction<T>(work: (tx: Tx, session: VerifiedSession, now: Date) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          // Existing auth timestamps are UTC without a zone; never inherit host-local conversion.
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const [{ nowMs }] = await tx.$queryRaw<Array<{ nowMs: bigint }>>`SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS "nowMs"`;
          const now = new Date(Number(nowMs));
          const claimed = await authenticatedSession(readSession, now);
          const current = await tx.session.findFirst({ where: { id: claimed.session.id, userId: claimed.user.id, expiresAt: { gt: now } }, select: { id: true, userId: true, createdAt: true, expiresAt: true } });
          if (!current) throw new FoundationError("UNAUTHENTICATED");
          const session = { user: claimed.user, session: current };
          return work(tx, session, now);
        }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 15000 });
      } catch (error) {
        // A competing unique business insert can win after our Serializable snapshot.
        // Roll back, reread and return its existing receipt; never retry a remote action.
        if (["P2034", "P2002"].includes(errorCode(error) ?? "") && attempt < 7) {
          await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)));
          continue;
        }
        throw safeError(error);
      }
    }
  }
  async function owner(tx: Tx, session: VerifiedSession, now: Date) {
    const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
    requireOwnerSession(session, binding?.userId ?? null, now);
  }
  async function audit(tx: Tx, actorId: string, userId: string, action: string, resourceId: string, reasonCode: string, meta: RequestMetadata, outcome = "SUCCESS") {
    await tx.websiteAuditEvent.create({ data: { actorId, targetUserId: userId, action, outcome, resourceId, reasonCode, requestId: meta.requestId, idempotencyKey: meta.idempotencyKey } });
  }
  async function mutate(action: string, input: object, metadata: RequestMetadata, ownerOnly: boolean, targetUserId: string | undefined,
    reasonCode: string, resourceId: string | undefined, work: (tx: Tx, userId: string, actorId: string, now: Date) => Promise<string>) {
    const meta = parse(metaSchema, metadata);
    let authorizedActor: string | undefined;
    try {
      return await transaction(async (tx, session, now) => {
        if (ownerOnly) { await owner(tx, session, now); authorizedActor = session.user.id; }
        const userId = ownerOnly ? parse(uuid, targetUserId) : session.user.id;
        const digest = createHash("sha256").update(canonical({ action, userId, input })).digest("hex");
        await tx.$executeRaw`INSERT INTO metro_website_request (id,"actorId","userId",action,key,digest,state)
          VALUES (${randomUUID()},${session.user.id},${userId},${action},${meta.idempotencyKey},${digest},'RUNNING')
          ON CONFLICT ("actorId",action,key) DO NOTHING`;
        const rows = await tx.$queryRaw<Array<{ id: string; digest: string; userId: string; state: string; resultId: string | null }>>`
          SELECT id,digest,"userId",state,"resultId" FROM metro_website_request
          WHERE "actorId"=${session.user.id} AND action=${action} AND key=${meta.idempotencyKey} FOR UPDATE`;
        const request = found(rows[0] ?? null);
        if (request.userId !== userId || request.digest !== digest) conflict();
        if (request.state === "DONE") return { id: found(request.resultId) };
        const resultId = await work(tx, userId, session.user.id, now);
        if (ownerOnly) await audit(tx, session.user.id, userId, action, resourceId ?? resultId, reasonCode, meta);
        await tx.websiteRequest.update({ where: { id: request.id }, data: { state: "DONE", resultId } });
        return { id: resultId };
      });
    } catch (error) {
      // The business transaction rolled back. Failure audit is a separate, sanitized append.
      if (ownerOnly && authorizedActor && targetUserId) {
        try { await transaction(async (tx, session, now) => { await owner(tx, session, now);
          await audit(tx, session.user.id, targetUserId, action, resourceId ?? targetUserId, reasonCode, meta, "FAILURE"); }); }
        catch { throw new FoundationError("UNAVAILABLE"); }
      }
      throw safeError(error);
    }
  }
  async function lockOrder(tx: Tx, orderId: string, userId: string) {
    await tx.$queryRaw`SELECT id FROM metro_website_order WHERE id=${orderId} AND "userId"=${userId} FOR UPDATE`;
    return found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId } }));
  }
  async function lockIssue(tx: Tx, issueId: string, userId: string) {
    await tx.$queryRaw`SELECT id FROM metro_support_issue WHERE id=${issueId} AND "userId"=${userId} FOR UPDATE`;
    return found(await tx.supportIssue.findFirst({ where: { id: issueId, userId } }));
  }
  return {
    async listOrders() { return transaction((tx, session) => tx.websiteOrder.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 100 })); },
    async listServices() { return transaction((tx, session) => tx.websiteServiceReference.findMany({ where: { userId: session.user.id }, take: 100 })); },
    async listIssues() { return transaction((tx, session) => tx.supportIssue.findMany({ where: { userId: session.user.id }, include: { events: { orderBy: { version: "asc" } } }, take: 100 })); },
    async order(orderId: string) { parse(uuid, orderId); return transaction(async (tx, session) => found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id } }))); },
    async createOrder(input: unknown, metadata: RequestMetadata) {
      const quote = parse(quoteSchema, input);
      return mutate("ORDER_CREATE", quote, metadata, false, undefined, "OWNER_READ", undefined, async (tx, userId, _actor, now) => {
        if (quote.owner.issuer !== WEBSITE_ISSUER || quote.owner.subject !== userId) throw new FoundationError("NOT_FOUND");
        const existing = await tx.websiteOrder.findFirst({ where: { quoteId: quote.id, userId } });
        if (existing) { if (canonical(existing.quoteSnapshot) !== canonical(quote)) conflict(); return existing.id; }
        if (new Date(quote.validUntil) <= now) conflict();
        // Input must come from the trusted catalog/quote service. No public checkout exists.
        return (await tx.websiteOrder.create({ data: { userId, quoteId: quote.id, quoteSnapshot: quote, totalMmk: quote.totalMmk } })).id;
      });
    },
    async addEvidence(input: unknown, metadata: RequestMetadata) {
      const data = parse(evidenceSchema, input);
      return mutate("EVIDENCE_ADD", data, metadata, false, undefined, "OWNER_READ", data.orderId, async (tx, userId) => {
        const order = await lockOrder(tx, data.orderId, userId);
        if (!["UNVERIFIED", "REJECTED", "UNDER_REVIEW"].includes(order.payment) || order.state !== "AWAITING_PAYMENT") conflict();
        const row = await tx.paymentEvidence.create({ data: { ...data, userId } });
        await tx.websiteOrder.update({ where: { id: order.id, userId }, data: { payment: "UNDER_REVIEW", version: { increment: 1 } } });
        return row.id;
      });
    },
    async listEvidence(orderId: string) { parse(uuid, orderId); return transaction(async (tx, session) => {
      found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id }, select: { id: true } }));
      return tx.paymentEvidence.findMany({ where: { orderId, userId: session.user.id }, select: { id: true, mediaType: true, bytes: true, createdAt: true } });
    }); },
    async decidePayment(input: unknown, metadata: RequestMetadata) {
      const data = parse(paymentSchema, input); const reason = data.decision === "APPROVED" ? "PAYMENT_MATCHED" : "EVIDENCE_REJECTED";
      return mutate("PAYMENT_DECISION", data, metadata, true, data.userId, reason, data.orderId, async (tx, userId, actorId) => {
        const order = await lockOrder(tx, data.orderId, userId);
        found(await tx.paymentEvidence.findFirst({ where: { id: data.evidenceId, orderId: order.id, userId } }));
        if (order.totalMmk.toFixed(0) !== data.amountMmk) conflict();
        const prior = await tx.paymentDecision.findUnique({ where: { verificationRef: data.verificationRef } });
        if (prior) {
          if (prior.orderId !== order.id || prior.userId !== userId || prior.evidenceId !== data.evidenceId || prior.decision !== data.decision || prior.amountMmk.toFixed(0) !== data.amountMmk) conflict();
          return prior.id;
        }
        if (order.payment !== "UNDER_REVIEW" || order.state !== "AWAITING_PAYMENT") conflict();
        assertTransition("payment", "UNDER_REVIEW", data.decision === "APPROVED" ? "CONFIRMED" : "REJECTED", { paymentAuthorityVerified: true, verificationId: data.verificationRef });
        const decision = await tx.paymentDecision.create({ data: { ...data, ownerId: actorId, reasonCode: reason } });
        if (data.decision === "APPROVED") {
          assertTransition("order", "AWAITING_PAYMENT", "FULFILMENT_PENDING", { payment: "CONFIRMED" });
          const operation = await tx.websiteOperation.create({ data: { userId, kind: "PROVISION", resourceKey: order.id, orderId: order.id, frozenSnapshot: order.quoteSnapshot as Prisma.InputJsonValue } });
          await tx.websiteOutboxEvent.create({ data: { userId, operationId: operation.id, topic: "VPN_FULFILMENT_REQUESTED", businessKey: `fulfil:${order.id}`, resourceId: order.id } });
          await tx.websiteOrder.update({ where: { id: order.id, userId }, data: { state: "FULFILMENT_PENDING", payment: "CONFIRMED", provisioning: "QUEUED", version: { increment: 1 } } });
        } else await tx.websiteOrder.update({ where: { id: order.id, userId }, data: { payment: "REJECTED", version: { increment: 1 } } });
        return decision.id;
      });
    },
    async reportIssue(input: unknown, metadata: RequestMetadata) {
      const data = parse(issueInput, input);
      return mutate("ISSUE_CREATE", data, metadata, false, undefined, "OWNER_READ", undefined, async (tx, userId, actorId) => {
        found(await tx.websiteServiceReference.findFirst({ where: { id: data.serviceId, userId } }));
        const issue = await tx.supportIssue.create({ data: { ...data, userId } });
        await tx.supportIssueEvent.create({ data: { issueId: issue.id, userId, actorId, kind: "REPORTED", attempt: 0, version: 0 } });
        await tx.websiteOutboxEvent.create({ data: { userId, topic: "WEBSITE_ISSUE_REPORTED", businessKey: `issue:${issue.id}`, resourceId: issue.id } });
        return issue.id;
      });
    },
    async recordDiagnosis(input: unknown, metadata: RequestMetadata) {
      const data = parse(diagnosisInput, input); const kind = data.result === "SUCCEEDED" ? "ADMIN_TEST_SUCCEEDED" : "ADMIN_TEST_FAILED";
      return mutate("ISSUE_DIAGNOSIS", data, metadata, true, data.userId, kind, data.issueId, async (tx, userId, actorId) => {
        const issue = await lockIssue(tx, data.issueId, userId);
        if (issue.version !== data.version || !["OPEN", "REVIEW_REQUIRED"].includes(issue.state)) conflict();
        const state = data.result === "SUCCEEDED" ? "TROUBLESHOOTING" : "REPLACEMENT_APPROVED";
        if (data.result === "SUCCEEDED" && issue.attempts >= 3) conflict();
        assertTransition("issue", issue.state as "OPEN" | "REVIEW_REQUIRED", "DIAGNOSING");
        assertTransition("issue", "DIAGNOSING", state, { failureVerified: data.result === "FAILED" });
        await tx.supportIssue.update({ where: { id: issue.id, userId, version: data.version }, data: { state, version: { increment: 1 } } });
        await tx.supportIssueEvent.create({ data: { issueId: issue.id, userId, actorId, kind, attempt: issue.attempts, version: issue.version + 1 } });
        return issue.id;
      });
    },
    async recordRetry(input: unknown, metadata: RequestMetadata) {
      const data = parse(retryInput, input);
      return mutate("ISSUE_RETRY", data, metadata, false, undefined, "OWNER_READ", data.issueId, async (tx, userId, actorId) => {
        const issue = await lockIssue(tx, data.issueId, userId);
        if (issue.version !== data.version || issue.attempts !== data.expectedAttempt || issue.attempts >= 3 || issue.state !== "TROUBLESHOOTING") conflict();
        const attempts = issue.attempts + 1;
        const state = data.result === "SUCCEEDED" ? "RESOLVED" : attempts === 3 ? "REVIEW_REQUIRED" : "TROUBLESHOOTING";
        if (state !== "TROUBLESHOOTING") assertTransition("issue", "TROUBLESHOOTING", state);
        await tx.supportIssue.update({ where: { id: issue.id, userId, version: data.version }, data: { attempts, state, version: { increment: 1 } } });
        await tx.supportIssueEvent.create({ data: { issueId: issue.id, userId, actorId, kind: data.result === "SUCCEEDED" ? "CUSTOMER_RETRY_SUCCEEDED" : "CUSTOMER_RETRY_FAILED", attempt: attempts, version: issue.version + 1 } });
        return issue.id;
      });
    },
    async requestReplacement(input: unknown, metadata: RequestMetadata) {
      const data = parse(replacementInput, input);
      return mutate("REPLACEMENT_REQUEST", data, metadata, true, data.userId, "VERIFIED_KEY_FAILURE", data.serviceId, async (tx, userId, _actor, now) => {
        // Serialize replacement intents without granting runtime UPDATE on backend projections.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`metro:replacement:${data.serviceId}`},0))::text`;
        const service = found(await tx.websiteServiceReference.findFirst({ where: { id: data.serviceId, userId } }));
        const issue = await lockIssue(tx, data.issueId, userId);
        if (issue.serviceId !== service.id) conflict();
        const resourceKey = `${service.id}:${data.expectedVersion}`;
        const prior = await tx.websiteOperation.findFirst({ where: { kind: "REPLACEMENT", resourceKey, userId } });
        if (prior) { if (prior.issueId !== issue.id) conflict(); return prior.id; }
        const snapshot = parse(entitlementSchema, service.snapshot);
        if (service.version !== data.expectedVersion || snapshot.version !== data.expectedVersion || snapshot.owner.subject !== userId ||
            issue.state !== "REPLACEMENT_APPROVED" || snapshot.status !== "ACTIVE" || snapshot.keyStatus !== "ENFORCED" || !snapshot.keyId ||
            new Date(snapshot.expiresAt) <= now || BigInt(snapshot.remainingBytes) <= BigInt(0)) conflict();
        const operation = await tx.websiteOperation.create({ data: { userId, kind: "REPLACEMENT", resourceKey, serviceId: service.id, issueId: issue.id, expectedVersion: service.version, frozenSnapshot: snapshot } });
        await tx.websiteOutboxEvent.create({ data: { userId, operationId: operation.id, topic: "VPN_REPLACEMENT_REQUESTED", businessKey: `replacement:${resourceKey}`, resourceId: operation.id } });
        return operation.id;
      });
    },
    async checkpoint(input: unknown, metadata: RequestMetadata) {
      const data = parse(z.strictObject({ ...ownerTarget, operationId: uuid, version: z.number().int().nonnegative(), state: z.enum(["PROCESSING", "RETRY_PENDING", "REVIEW_REQUIRED"]) }), input);
      return mutate("CHECKPOINT", data, metadata, true, data.userId, "WORKER_CHECKPOINT", data.operationId, async (tx, userId) => {
        const operation = found(await tx.websiteOperation.findFirst({ where: { id: data.operationId, userId } }));
        if (operation.version !== data.version) conflict();
        if (!["QUEUED", "PROCESSING", "RETRY_PENDING"].includes(operation.state)) conflict();
        assertTransition("provisioning", operation.state as "QUEUED" | "PROCESSING" | "RETRY_PENDING", data.state);
        const changed = await tx.websiteOperation.updateMany({ where: { id: operation.id, userId, version: data.version, state: operation.state }, data: { state: data.state, version: { increment: 1 } } });
        if (changed.count !== 1) conflict(); return operation.id;
      });
    },
    async claimOutbox(input: unknown, metadata: RequestMetadata) {
      const data = parse(z.strictObject({ ...ownerTarget, eventId: uuid, version: z.number().int().nonnegative() }), input);
      return mutate("OUTBOX_CLAIM", data, metadata, true, data.userId, "WORKER_CHECKPOINT", data.eventId, async (tx, userId, _actor, now) => {
        const row = found(await tx.websiteOutboxEvent.findFirst({ where: { id: data.eventId, userId } }));
        if (row.version !== data.version || row.availableAt > now || row.state === "DELIVERED" || row.state === "LEASED" && row.leaseUntil! > now) conflict();
        const changed = await tx.websiteOutboxEvent.updateMany({ where: { id: row.id, userId, version: data.version }, data: { state: "LEASED", leaseId: randomUUID(), leaseUntil: new Date(now.getTime() + 30000), attempts: { increment: 1 }, version: { increment: 1 } } });
        if (changed.count !== 1) conflict(); return row.id;
      });
    },
    async acknowledgeOutbox(input: unknown, metadata: RequestMetadata) {
      const data = parse(z.strictObject({ ...ownerTarget, eventId: uuid, version: z.number().int().nonnegative(), leaseId: uuid }), input);
      return mutate("OUTBOX_ACK", data, metadata, true, data.userId, "WORKER_CHECKPOINT", data.eventId, async (tx, userId, _actor, now) => {
        const changed = await tx.websiteOutboxEvent.updateMany({ where: { id: data.eventId, userId, version: data.version, state: "LEASED", leaseId: data.leaseId, leaseUntil: { gt: now } }, data: { state: "DELIVERED", leaseId: null, leaseUntil: null, version: { increment: 1 } } });
        if (changed.count !== 1) conflict(); return data.eventId;
      });
    },
    async ownerRecords(userId: string, metadata: RequestMetadata) {
      parse(uuid, userId);
      // Audit metadata contains IDs/codes only; read is owner-scoped and requires recent auth.
      const meta = parse(metaSchema, metadata);
      return transaction(async (tx, session, now) => { await owner(tx, session, now);
        await audit(tx, session.user.id, userId, "AUDIT_READ", userId, "OWNER_READ", meta);
        return {
        orders: await tx.websiteOrder.findMany({ where: { userId }, take: 100 }),
        evidence: await tx.paymentEvidence.findMany({ where: { userId }, take: 100 }),
        decisions: await tx.paymentDecision.findMany({ where: { userId }, take: 100 }),
        issues: await tx.supportIssue.findMany({ where: { userId }, include: { events: true }, take: 100 }),
        operations: await tx.websiteOperation.findMany({ where: { userId }, take: 100 }),
        outbox: await tx.websiteOutboxEvent.findMany({ where: { userId }, take: 100 }),
        audit: await tx.websiteAuditEvent.findMany({ where: { targetUserId: userId }, take: 100 }),
      }; });
    },
  };
}
