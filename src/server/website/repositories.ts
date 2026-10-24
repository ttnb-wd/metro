import "server-only";
import { evidenceReferenceSchema } from "../commerce/evidence-reference";
import { MAX_PAYMENT_PROOF_BYTES } from "@/features/commerce/evidence-policy";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "../db/generated/client";
import { authenticatedSession, requireOwnerSession, readWebsiteSession, FoundationError, type SessionReader, type VerifiedSession } from "../owner/authorization";
import { quoteSchema, entitlementSchema, WEBSITE_ISSUER } from "../vpn/contracts";
import { assertTransition } from "../vpn/states";
import { readPricing } from "../pricing/store";
import { calculateWebsiteQuote } from "@/features/pricing/catalog";
import type { QuoteEnvelope } from "../commerce/quote";
import { queueNotice } from "../notifications/store";
import { notificationsEnabled, noticePayload, supportNotice } from "../notifications/policy";
import { rejectionReasonSchema, rejectionReasons } from "@/features/pricing/payment-review";
import { checkoutInvoiceSchema } from "../commerce/quote";
import type { OrderReceipt } from "@/features/pricing/receipt";
import { currentProvisioning } from "@/features/pricing/order-status";
import { securityDiagnostic } from "../security/diagnostics";

type Tx = Prisma.TransactionClient;
const uuid = z.uuid();
const metaSchema = z.strictObject({ requestId: uuid, idempotencyKey: uuid });
export type RequestMetadata = z.infer<typeof metaSchema>;
const text = z.string().trim().min(1).max(1000).refine(value => !/(ss:\/\/|postgres(?:ql)?:\/\/|bearer\s)/i.test(value));
const evidenceSchema = z.strictObject({ orderId: uuid, storageRef: evidenceReferenceSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), mediaType: z.enum(["image/png", "image/jpeg", "application/pdf"]), bytes: z.number().int().min(1).max(10485760) });
const checkoutEvidenceSchema = evidenceSchema.omit({ orderId: true }).extend({ mediaType: z.literal("image/png"), bytes: z.number().int().min(1).max(MAX_PAYMENT_PROOF_BYTES) });
const ownerTarget = { userId: uuid };
const paymentSchema = z.strictObject({ ...ownerTarget, orderId: uuid, evidenceId: uuid, verificationRef: uuid,
  reviewedVersion: z.number().int().nonnegative(), reviewedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  amountMmk: z.string().regex(/^[1-9][0-9]{0,29}$/), decision: z.enum(["APPROVED", "REJECTED"]), rejectionReason: rejectionReasonSchema.optional() });
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
function transactionRetryable(error: unknown): boolean {
  if (["P2034", "P2002"].includes(errorCode(error) ?? "")) return true;
  // pg adapter exposes SQL serialization/deadlock failures from raw ON CONFLICT
  // statements as P2010. Retry the entire local transaction, not an API call.
  if (errorCode(error) !== "P2010" || !error || typeof error !== "object" || !("meta" in error)) return false;
  const parsed = z.object({ code: z.string().optional(), driverAdapterError: z.object({ cause: z.object({ originalCode: z.string().optional() }).optional() }).optional() }).safeParse(error.meta);
  return parsed.success && ["40001", "40P01"].includes(parsed.data.code ?? parsed.data.driverAdapterError?.cause?.originalCode ?? "");
}
function safeError(error: unknown): FoundationError {
  return error instanceof FoundationError ? error : new FoundationError(["P2002", "P2003", "P2034"].includes(errorCode(error) ?? "") ? "CONFLICT" : "UNAVAILABLE");
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}

async function createPricedOrder(tx: Tx, input: QuoteEnvelope, userId: string, now: Date) {
  if (input.userId !== userId) throw new FoundationError("FORBIDDEN");
  const existing = await tx.websiteOrder.findUnique({ where: { quoteId: input.id } });
  if (existing) { if (existing.userId !== userId) conflict(); return existing.id; }
  if (now.getTime() >= input.expiresAt) conflict();
  // The same advisory lock is held by pricing publication. A quote cannot
  // sneak through while a new version is being committed. ReadCommitted
  // below is deliberate: the read AFTER waiting must see the new release,
  // not an older Serializable snapshot captured before acquiring the lock.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('metro:website-pricing',0))::text`;
  const [{ currentMs }] = await tx.$queryRaw<Array<{ currentMs: bigint }>>`SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint AS "currentMs"`;
  if (Number(currentMs) >= input.expiresAt) conflict();
  const pricing = await readPricing(tx);
  if (pricing.status !== "READY" || pricing.release.version !== input.version) conflict();
  const quote = calculateWebsiteQuote(pricing.release, { packageId: input.packageId, months: input.months, version: input.version });
  if (BigInt(quote.totalMmk) <= BigInt(0)) throw new FoundationError("INVALID_REQUEST");
  const snapshot = { ...quote, id: input.id, owner: { issuer: WEBSITE_ISSUER, subject: userId }, paymentMethod: input.paymentMethod };
  return (await tx.websiteOrder.create({ data: { userId, quoteId: input.id, quoteSnapshot: snapshot, totalMmk: quote.totalMmk } })).id;
}

// Construct through the verified disposable adapter or gated production factory.
export function buildRepositories(db: PrismaClient, readSession: SessionReader = readWebsiteSession) {
  async function transaction<T>(work: (tx: Tx, session: VerifiedSession, now: Date) => Promise<T>, isolationLevel: "Serializable" | "ReadCommitted" = "Serializable") {
    const rawSession = await readSession();
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          // Existing auth timestamps are UTC without a zone; never inherit host-local conversion.
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const [{ nowMs }] = await tx.$queryRaw<Array<{ nowMs: bigint }>>`SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS "nowMs"`;
          const now = new Date(Number(nowMs));
          const claimed = await authenticatedSession(async () => rawSession, now);
          const current = await tx.session.findFirst({ where: { id: claimed.session.id, userId: claimed.user.id, expiresAt: { gt: now } }, select: { id: true, userId: true, createdAt: true, expiresAt: true } });
          if (!current) throw new FoundationError("UNAUTHENTICATED");
          const session = { user: claimed.user, session: current };
          return work(tx, session, now);
        }, { isolationLevel, maxWait: 10000, timeout: 15000 });
      } catch (error) {
        // A competing unique business insert can win after our Serializable snapshot.
        // Roll back, reread and return its existing receipt; never retry a remote action.
        if (transactionRetryable(error) && attempt < 7) {
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
    if (!await tx.user.findFirst({ where: { id: session.user.id, emailVerified: true }, select: { id: true } })) throw new FoundationError("FORBIDDEN");
  }
  async function audit(tx: Tx, actorId: string, userId: string, action: string, resourceId: string, reasonCode: string, meta: RequestMetadata, outcome = "SUCCESS") {
    await tx.websiteAuditEvent.create({ data: { actorId, targetUserId: userId, action, outcome, resourceId, reasonCode, requestId: meta.requestId, idempotencyKey: meta.idempotencyKey } });
  }
  async function mutate(action: string, input: object, metadata: RequestMetadata, ownerOnly: boolean, targetUserId: string | undefined,
    reasonCode: string, resourceId: string | undefined, work: (tx: Tx, userId: string, actorId: string, now: Date) => Promise<string>, isolationLevel: "Serializable" | "ReadCommitted" = "Serializable") {
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
      }, isolationLevel);
    } catch (error) {
      if (ownerOnly && !authorizedActor) securityDiagnostic("OWNER_DENIED");
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
    async notifications() { return transaction(async (tx, session) => {
      if (!notificationsEnabled()) return { enabled: false, items: [], unread: 0 };
      const where = { userId: session.user.id };
      const rows = await tx.websiteNotification.findMany({ where, take: 50, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, payload: true, href: true, readAt: true, createdAt: true } });
      return { enabled: true, items: rows.map(row => ({ ...row, payload: noticePayload.parse(row.payload) })), unread: await tx.websiteNotification.count({ where: { ...where, readAt: null } }) };
    }); },
    async readNotification(id: string, read: boolean) { parse(uuid, id); return transaction(async (tx, session, now) => {
      if (!notificationsEnabled()) throw new FoundationError("DISABLED");
      found(await tx.websiteNotification.findFirst({ where: { id, userId: session.user.id }, select: { id: true } }));
      await tx.websiteNotification.update({ where: { id, userId: session.user.id }, data: { readAt: read ? now : null } });
    }); },
    async createWebsiteOrder(input: QuoteEnvelope, metadata: RequestMetadata) {
      return mutate("ORDER_CREATE", input, metadata, false, undefined, "OWNER_READ", undefined, async (tx, userId, _actor, now) => {
        return createPricedOrder(tx, input, userId, now);
      }, "ReadCommitted");
    },
    async submitDraftPayment(orderId: string, receipt: unknown, metadata: RequestMetadata) {
      parse(uuid, orderId); const proof = parse(checkoutEvidenceSchema, receipt);
      // Storage IDs change on transport retries. Bind idempotency to the signed
      // order and normalized file content, never to a temporary storage ID.
      const request = { orderId, proof: { sha256: proof.sha256, bytes: proof.bytes, mediaType: proof.mediaType } };
      return mutate("EVIDENCE_ADD", request, metadata, false, undefined, "OWNER_READ", orderId, async (tx, userId, _actor, now) => {
        const id = orderId;
        const order = await lockOrder(tx, id, userId);
        const existing = await tx.paymentEvidence.findFirst({ where: { orderId: id, userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (existing && order.payment !== "REJECTED") { if (existing.sha256 !== proof.sha256) conflict(); return id; }
        if (order.state !== "AWAITING_PAYMENT" || !["UNVERIFIED", "REJECTED"].includes(order.payment)) conflict();
        if (existing && !await tx.paymentDecision.findFirst({ where: { evidenceId: existing.id, decision: "REJECTED" } })) conflict();
        if (await tx.paymentEvidence.count({ where: { orderId: id, userId } }) >= 3) conflict();
        const evidence = await tx.paymentEvidence.create({ data: { ...proof, orderId: id, userId } });
        await tx.websiteOrder.update({ where: { id, userId }, data: { payment: "UNDER_REVIEW", version: { increment: 1 } } });
        if (notificationsEnabled()) {
          const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
          if (binding) await queueNotice(tx, { userId: binding.userId, audience: "OWNER", kind: "PAYMENT_PROOF_SUBMITTED", dedupeKey: `payment-proof:${evidence.id}`, href: `/admin/orders/${id}`, payload: { title: "Payment proof is awaiting review", message: "Review the private receipt and verify the actual receiving account and exact order amount before approving payment.", action: "Review payment", observedAt: now.toISOString() } });
        }
        return id;
      }, "ReadCommitted");
    },
    async checkoutReceipt(orderId: string) { parse(uuid, orderId); return transaction(async (tx, session) => {
      const order = await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id }, select: { id: true, payment: true } });
      if (!order) return null;
      const receipt = await tx.paymentEvidence.findFirst({ where: { orderId: order.id, userId: session.user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, storageRef: true, sha256: true } });
      return receipt ? { ...receipt, orderId: order.id, payment: order.payment } : null;
    }); },
    async reserveEvidenceUpload(orderId: string) {
      parse(uuid, orderId);
      return transaction(async (tx, session) => {
        const userId = session.user.id;
        // Account lock bounds concurrent storage spending across different drafts.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evidence-budget:${userId}`},0))::text`;
        const order = await lockOrder(tx, orderId, userId);
        if (order.state !== "AWAITING_PAYMENT" || !["UNVERIFIED", "REJECTED"].includes(order.payment)) conflict();
        const prior = await tx.paymentEvidence.findFirst({ where: { orderId, userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (prior && (order.payment !== "REJECTED" || !await tx.paymentDecision.findFirst({ where: { evidenceId: prior.id, decision: "REJECTED" } }))) conflict();
        if (await tx.paymentEvidence.count({ where: { orderId, userId } }) >= 3) conflict();
        const digest = createHash("sha256").update(`evidence-upload:${orderId}`).digest("hex");
        // Existing CHECKPOINT receipts retain failed attempts too: ten 4 MiB
        // attempts per order, 100 per account for its lifetime (400 MiB cap).
        if (await tx.websiteRequest.count({ where: { userId, action: "CHECKPOINT", digest } }) >= 10
          || await tx.websiteRequest.count({ where: { userId, action: "CHECKPOINT", resultId: { startsWith: "evidence-upload:" } } }) >= 100) conflict();
        const id = randomUUID();
        await tx.websiteRequest.create({ data: { id, actorId: userId, userId, action: "CHECKPOINT", key: id, digest, state: "DONE", resultId: `evidence-upload:${orderId}:${id}` } });
        return id;
      }, "ReadCommitted");
    },
    async evidenceIsUnreferenced(orderId: string, storageRef: string) {
      parse(uuid, orderId); parse(evidenceReferenceSchema, storageRef);
      // Serialize recovery with submission before deciding whether an upload
      // can be removed. A committed receipt always wins, including a lost reply.
      return transaction(async (tx, session) => {
        await lockOrder(tx, orderId, session.user.id);
        return await tx.paymentEvidence.count({ where: { storageRef } }) === 0;
      }, "ReadCommitted");
    },
    async listOrders() { return transaction(async (tx, session) => {
      const rows = await tx.websiteOrder.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 100, include: { operations: { where: { kind: "PROVISION" }, take: 1, select: { state: true } } } });
      return rows.map(({ operations, ...row }) => ({ ...row, provisioning: currentProvisioning(row, operations[0]?.state) }));
    }); },
    async listServices() { return transaction(async (tx, session) => {
      const services = await tx.websiteServiceReference.findMany({ where: { userId: session.user.id }, take: 100 });
      if (!services.length) return [];
      const orders = await tx.websiteOrder.findMany({ where: { userId: session.user.id, payment: "CONFIRMED", state: "COMPLETE" }, select: { quoteSnapshot: true }, orderBy: { createdAt: "desc" }, take: 100 });
      return services.map(service => {
        const entitlement = entitlementSchema.safeParse(service.snapshot);
        const purchase = entitlement.success && entitlement.data.owner.subject === session.user.id
          ? orders.map(order => z.object({ packageId: uuid, packageName: z.string().min(1).max(80) }).safeParse(order.quoteSnapshot)).find(order => order.success && order.data.packageId === entitlement.data.packageId) : undefined;
        return { ...service, packageName: purchase?.success ? purchase.data.packageName : null };
      });
    }); },
    async service(serviceId: string) { parse(uuid, serviceId); return transaction(async (tx, session) => found(await tx.websiteServiceReference.findFirst({ where: { id: serviceId, userId: session.user.id } }))); },
    async evidenceFile(evidenceId: string) {
      parse(uuid, evidenceId);
      return transaction(async (tx, session, now) => {
        const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 } });
        const isOwner = binding?.userId === session.user.id;
        if (isOwner) await owner(tx, session, now);
        const row = found(await tx.paymentEvidence.findFirst({ where: { id: evidenceId, ...(isOwner ? {} : { userId: session.user.id }) } }));
        if (isOwner) { const meta = { requestId: randomUUID(), idempotencyKey: randomUUID() }; await audit(tx, session.user.id, row.userId, "EVIDENCE_READ", row.id, "OWNER_READ", meta); }
        return row;
      });
    },
    async evidenceReplay(orderId: string, requestKey: string) {
      parse(uuid, orderId); parse(uuid, requestKey);
      return transaction(async (tx, session) => {
        const receipt = await tx.websiteRequest.findUnique({ where: { actorId_action_key: { actorId: session.user.id, action: "EVIDENCE_ADD", key: requestKey } } });
        if (!receipt || receipt.state !== "DONE" || receipt.userId !== session.user.id || !receipt.resultId) return null;
        return found(await tx.paymentEvidence.findFirst({ where: { id: receipt.resultId, orderId, userId: session.user.id } }));
      });
    },
    async listIssues() { return transaction((tx, session) => tx.supportIssue.findMany({ where: { userId: session.user.id }, include: { events: { orderBy: { version: "asc" } } }, take: 100 })); },
    async order(orderId: string) { parse(uuid, orderId); return transaction(async (tx, session) => {
      const { operations, ...row } = found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id }, include: { operations: { where: { kind: "PROVISION" }, take: 1, select: { state: true } } } }));
      return { ...row, provisioning: currentProvisioning(row, operations[0]?.state) };
    }); },
    async orderReceipt(orderId: string): Promise<OrderReceipt> {
      parse(uuid, orderId);
      return transaction(async (tx, session) => {
        const order = found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id }, select: {
          id: true, quoteSnapshot: true, totalMmk: true, state: true, payment: true, provisioning: true, createdAt: true,
          user: { select: { name: true, email: true } }, evidence: { orderBy: { createdAt: "asc" }, select: { createdAt: true } },
          decisions: { where: { decision: "APPROVED" }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
          operations: { where: { kind: "PROVISION" }, select: { id: true, state: true } },
        } }));
        if (!order.evidence.length || order.payment === "UNVERIFIED") throw new FoundationError("NOT_FOUND");
        if (order.payment === "CONFIRMED" && !order.decisions.length) throw new FoundationError("UNAVAILABLE");
        const parsed = checkoutInvoiceSchema.extend({ monthlyPriceMmk: z.string().regex(/^[0-9]+$/).optional() }).safeParse(order.quoteSnapshot);
        if (!parsed.success || parsed.data.totalMmk !== order.totalMmk.toFixed(0)
          || BigInt(parsed.data.regularMmk) - BigInt(parsed.data.savedMmk) !== BigInt(parsed.data.totalMmk)) throw new FoundationError("UNAVAILABLE");
        const provisioning = currentProvisioning(order, order.operations[0]?.state);
        const completed = order.state === "COMPLETE" && provisioning === "SUCCEEDED";
        const notice = completed && order.operations.length ? await tx.websiteNotification.findFirst({ where: {
          userId: session.user.id, kind: { in: ["SERVICE_ACTIVATED", "SERVICE_RENEWED", "SERVICE_REACTIVATED"] },
          dedupeKey: { in: order.operations.map(operation => `operation:${operation.id}`) },
        }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }) : null;
        // The receipt price is historical. Subscription expiry is explicitly a
        // current observation, never an inferred original activation/expiry.
        const references = completed ? await tx.websiteServiceReference.findMany({ where: { userId: session.user.id }, take: 2, select: { snapshot: true } }) : [];
        const current = references.length === 1 ? entitlementSchema.safeParse(references[0].snapshot) : null;
        const subscription = current?.success && current.data.owner.subject === session.user.id ? current.data : null;
        return { id: order.id, customer: order.user, plan: parsed.data, state: order.state, payment: order.payment, provisioning,
          createdAt: order.createdAt.toISOString(), submittedAt: order.evidence[0].createdAt.toISOString(), latestSubmissionAt: order.evidence[order.evidence.length - 1].createdAt.toISOString(),
          approvedAt: order.decisions[0]?.createdAt.toISOString() ?? null, activationRecordedAt: notice?.createdAt.toISOString() ?? null,
          currentExpiry: subscription?.expiresAt ?? null, expiryObservedAt: subscription?.observedAt ?? null };
      }, "ReadCommitted");
    },
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
      const { orderId, ...proof } = data;
      await this.submitDraftPayment(orderId, proof, metadata);
      const accepted = found(await this.checkoutReceipt(orderId));
      return { id: accepted.id };
    },
    async listEvidence(orderId: string) { parse(uuid, orderId); return transaction(async (tx, session) => {
      found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id }, select: { id: true } }));
      return tx.paymentEvidence.findMany({ where: { orderId, userId: session.user.id }, select: { id: true, mediaType: true, bytes: true, createdAt: true } });
    }); },
    async decidePayment(input: unknown, metadata: RequestMetadata) {
      const data = parse(paymentSchema, input); const reason = data.decision === "APPROVED" ? "PAYMENT_MATCHED" : "EVIDENCE_REJECTED";
      return mutate("PAYMENT_DECISION", data, metadata, true, data.userId, reason, data.orderId, async (tx, userId, actorId) => {
        const order = await lockOrder(tx, data.orderId, userId);
        const evidence = found(await tx.paymentEvidence.findFirst({ where: { id: data.evidenceId, orderId: order.id, userId } }));
        if (evidence.sha256 !== data.reviewedSha256) conflict();
        if (order.totalMmk.toFixed(0) !== data.amountMmk) conflict();
        const prior = await tx.paymentDecision.findUnique({ where: { verificationRef: data.verificationRef } });
        if (prior) {
          if (prior.orderId !== order.id || prior.userId !== userId || prior.evidenceId !== data.evidenceId || prior.decision !== data.decision || prior.amountMmk.toFixed(0) !== data.amountMmk) conflict();
          return prior.id;
        }
        // A rejected proof cannot be approved later when a new upload puts the
        // order back under review. A new payment review requires new evidence.
        if (await tx.paymentDecision.findFirst({ where: { evidenceId: data.evidenceId } })) conflict();
        if (data.rejectionReason && (data.decision !== "REJECTED" || !notificationsEnabled())) throw new FoundationError("UNAVAILABLE");
        if (order.payment !== "UNDER_REVIEW" || order.state !== "AWAITING_PAYMENT") conflict();
        if (order.version !== data.reviewedVersion) conflict();
        const latest = await tx.paymentEvidence.findFirst({ where: { orderId: order.id, userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
        if (latest?.id !== evidence.id) conflict();
        assertTransition("payment", "UNDER_REVIEW", data.decision === "APPROVED" ? "CONFIRMED" : "REJECTED", { paymentAuthorityVerified: true, verificationId: data.verificationRef });
        const { rejectionReason, reviewedVersion: _reviewedVersion, reviewedSha256: _reviewedSha256, ...decisionData } = data;
        void _reviewedVersion; void _reviewedSha256;
        const decision = await tx.paymentDecision.create({ data: { ...decisionData, ownerId: actorId, reasonCode: reason } });
        if (data.decision === "REJECTED" && rejectionReason) await queueNotice(tx, { userId, audience: "CUSTOMER", kind: "PAYMENT_REJECTED", dedupeKey: `payment-decision:${decision.id}`, href: `/dashboard/orders/${order.id}`, payload: { title: "Payment proof needs attention", message: rejectionReasons[rejectionReason], action: "Review order", observedAt: new Date().toISOString() } });
        if (data.decision === "APPROVED") {
          await queueNotice(tx, { userId, audience: "CUSTOMER", kind: "PAYMENT_CONFIRMED", dedupeKey: `payment-decision:${decision.id}`, href: `/dashboard/orders/${order.id}`, payload: { title: "Metro confirmed your payment", message: "Your payment was confirmed after OWNER review. VPN activation is queued and will be shown separately when its finite quota and expiry are verified.", action: "View order", observedAt: new Date().toISOString() } });
          assertTransition("order", "AWAITING_PAYMENT", "FULFILMENT_PENDING", { payment: "CONFIRMED" });
          const operation = await tx.websiteOperation.create({ data: { userId, kind: "PROVISION", resourceKey: order.id, orderId: order.id, frozenSnapshot: order.quoteSnapshot as Prisma.InputJsonValue } });
          await tx.websiteOutboxEvent.create({ data: { userId, operationId: operation.id, topic: "VPN_FULFILMENT_REQUESTED", businessKey: `fulfil:${order.id}`, resourceId: order.id } });
          await tx.websiteOrder.update({ where: { id: order.id, userId }, data: { state: "FULFILMENT_PENDING", payment: "CONFIRMED", provisioning: "QUEUED", version: { increment: 1 } } });
        } else await tx.websiteOrder.update({ where: { id: order.id, userId }, data: { payment: "REJECTED", version: { increment: 1 } } });
        return decision.id;
      });
    },
    async orderUpdates(orderId: string) { parse(uuid, orderId); return transaction(async (tx, session) => {
      found(await tx.websiteOrder.findFirst({ where: { id: orderId, userId: session.user.id }, select: { id: true } }));
      const rows = await tx.websiteNotification.findMany({ where: { userId: session.user.id, kind: "PAYMENT_REJECTED", href: `/dashboard/orders/${orderId}` }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, payload: true, createdAt: true } });
      return rows.map(row => ({ ...row, payload: noticePayload.parse(row.payload) }));
    }); },
    async reportIssue(input: unknown, metadata: RequestMetadata) {
      const data = parse(issueInput, input);
      return mutate("ISSUE_CREATE", data, metadata, false, undefined, "OWNER_READ", undefined, async (tx, userId, actorId) => {
        found(await tx.websiteServiceReference.findFirst({ where: { id: data.serviceId, userId } }));
        const issue = await tx.supportIssue.create({ data: { ...data, userId } });
        await tx.supportIssueEvent.create({ data: { issueId: issue.id, userId, actorId, kind: "REPORTED", attempt: 0, version: 0 } });
        await tx.websiteOutboxEvent.create({ data: { userId, topic: "WEBSITE_ISSUE_REPORTED", businessKey: `issue:${issue.id}`, resourceId: issue.id } });
        if (notificationsEnabled()) {
          const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
          if (binding) await queueNotice(tx, { userId: binding.userId, audience: "OWNER", kind: "ISSUE_REPORTED", dedupeKey: `owner-issue:${issue.id}`, href: `/admin/support/${issue.id}`, payload: { title: "A customer reported a VPN connection issue", message: "Review the authenticated customer, current entitlement and issue history in Metro. No VPN credentials are included in this notification.", action: "Review support ticket", observedAt: new Date().toISOString() } });
        }
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
        await queueNotice(tx, supportNotice(userId, issue.id, issue.version + 1, state, new Date()));
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
        await queueNotice(tx, supportNotice(userId, issue.id, issue.version + 1, state, new Date()));
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
    async retryOperation(input: unknown, metadata: RequestMetadata) {
      const data = parse(z.strictObject({ ...ownerTarget, operationId: uuid, version: z.number().int().nonnegative() }), input);
      return mutate("CHECKPOINT", data, metadata, true, data.userId, "WORKER_CHECKPOINT", data.operationId, async (tx, userId, _actor, now) => {
        const operation = found(await tx.websiteOperation.findFirst({ where: { id: data.operationId, userId, version: data.version, state: "REVIEW_REQUIRED" } }));
        if (operation.orderId) {
          const order = await lockOrder(tx, operation.orderId, userId);
          if (order.payment !== "CONFIRMED" || order.state !== "REVIEW_REQUIRED") conflict();
          await tx.websiteOrder.update({ where: { id: order.id }, data: { state: "FULFILMENT_PENDING", provisioning: "QUEUED", version: { increment: 1 } } });
        }
        assertTransition("provisioning", "REVIEW_REQUIRED", "QUEUED", { payment: "CONFIRMED" });
        await tx.websiteOperation.update({ where: { id: operation.id, userId, version: data.version }, data: { state: "QUEUED", version: { increment: 1 } } });
        await tx.websiteOutboxEvent.updateMany({ where: { operationId: operation.id, userId, state: { not: "DELIVERED" }, OR: [{ state: "PENDING" }, { leaseUntil: { lte: now } }] }, data: { state: "PENDING", leaseId: null, leaseUntil: null, availableAt: now, attempts: 0, version: { increment: 1 } } });
        return operation.id;
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
