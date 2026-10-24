import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../db/generated/client";
import { entitlementSchema } from "../vpn/contracts";
import { fulfilmentEnabled } from "./config";
import { callVpnService } from "../vpn/transport";
import { queueNotice } from "../notifications/store";
import { statusNotice } from "../notifications/policy";
import { validateFulfilmentResult, fulfilmentReceiptSchema } from "./fulfilment-result";
import { assertDispatchAuthority, WorkerReviewError } from "./worker-authority";

type Transport = (action: "fulfil" | "replace" | "entitlement", input: object) => Promise<unknown>;
/** Dedicated process/role, not a public cron endpoint or a customer session. */
export function buildFulfilmentWorker(db: PrismaClient, transport: Transport, enabled: boolean | (() => boolean), observationEnabled: boolean | (() => boolean) = enabled) {
  const active = (gate: boolean | (() => boolean)) => typeof gate === "function" ? gate() : gate;
  // Prisma timestamps are UTC without a zone. Lease comparisons must not
  // reinterpret them in the database host's local timezone after a restart.
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    return work(tx);
  });
  return {
    async runOne() {
      if (!active(enabled)) return { status: "DISABLED" as const };
      const lease = randomUUID();
      const event = await transaction(async tx => {
        const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT event.id FROM metro_website_outbox event
          JOIN metro_website_operation operation ON operation.id=event."operationId" AND operation."userId"=event."userId"
          WHERE event.topic IN ('VPN_FULFILMENT_REQUESTED','VPN_REPLACEMENT_REQUESTED')
          AND operation.state IN ('QUEUED','PROCESSING','RETRY_PENDING')
          AND event.state <> 'DELIVERED' AND event."availableAt" <= clock_timestamp()
          AND (event.state <> 'LEASED' OR event."leaseUntil" < clock_timestamp()) ORDER BY event."createdAt" FOR UPDATE OF event SKIP LOCKED LIMIT 1`;
        if (!row) return null;
        return tx.websiteOutboxEvent.update({ where: { id: row.id }, data: { state: "LEASED", leaseId: lease, leaseUntil: new Date(Date.now() + 60_000), attempts: { increment: 1 }, version: { increment: 1 } }, include: { operation: true } });
      });
      if (!event?.operation) return { status: "IDLE" as const };
      const operation = event.operation;
      let stage: "AUTHORIZATION" | "BACKEND" | "RECEIPT" | "COMMIT" = "AUTHORIZATION";
      try {
        await db.websiteOperation.updateMany({ where: { id: operation.id, state: { in: ["QUEUED", "RETRY_PENDING", "PROCESSING"] } }, data: { state: "PROCESSING", version: { increment: 1 } } });
        await transaction(tx => assertDispatchAuthority(tx, operation));
        if (!active(enabled)) throw new Error("Execution gate closed.");
        const snapshot = operation.frozenSnapshot as Record<string, unknown>;
        const owner = { issuer: "metro-website", subject: operation.userId };
        stage = "BACKEND";
        const rawResult = await transport(operation.kind === "REPLACEMENT" ? "replace" : "fulfil", operation.kind === "REPLACEMENT" ? { owner, operationId: operation.id, issueId: operation.issueId, entitlementId: snapshot.id, expectedVersion: operation.expectedVersion, failureVerified: true, resultProtocol: "metro-fulfilment-receipt.v1" } : { owner, operationId: operation.id, orderId: operation.orderId, quote: snapshot, resultProtocol: "metro-fulfilment-receipt.v1" });
        stage = "RECEIPT";
        let receipt, result;
        try { receipt = fulfilmentReceiptSchema.parse(rawResult); result = validateFulfilmentResult(receipt, operation); }
        catch { throw new WorkerReviewError("RECEIPT_REVIEW_REQUIRED"); }
        if (result.owner.subject !== operation.userId || result.owner.issuer !== owner.issuer || result.status !== "ACTIVE" || result.keyStatus !== "ENFORCED" || !result.keyId || new Date(result.expiresAt).getTime() <= Date.now()) throw new Error();
        if (operation.kind === "PROVISION" && (result.packageId !== snapshot.packageId || BigInt(result.totalBytes) < BigInt(String(snapshot.quotaBytes)))) throw new Error();
        if (operation.kind === "REPLACEMENT" && (result.id !== snapshot.id || result.keyId === snapshot.keyId || result.expiresAt !== snapshot.expiresAt || result.totalBytes !== snapshot.totalBytes || BigInt(result.usedBytes) < BigInt(String(snapshot.usedBytes)))) throw new Error();
        stage = "COMMIT";
        await transaction(async tx => {
          const owned = await tx.websiteOutboxEvent.findFirst({ where: { id: event.id, state: "LEASED", leaseId: lease, leaseUntil: { gt: new Date() } } });
          if (!owned) throw new Error();
          const currentOperation = await tx.websiteOperation.findFirst({ where: { id: operation.id, userId: operation.userId, state: "PROCESSING" } });
          if (!currentOperation) throw new WorkerReviewError("OPERATION_STATE_CHANGED");
          await assertDispatchAuthority(tx, currentOperation);
          const prior = await tx.websiteServiceReference.findUnique({ where: { externalId: result.id } });
          const other = await tx.websiteServiceReference.findFirst({ where: { userId: operation.userId, externalId: { not: result.id } }, select: { id: true } });
          if (other || prior && !receipt.before) throw new Error();
          const previous = entitlementSchema.safeParse(prior?.snapshot);
          if (previous.success) validateFulfilmentResult(receipt, operation, Date.now(), previous.data);
          const reactivated = previous.success && (BigInt(previous.data.remainingBytes) === BigInt(0) || Date.parse(previous.data.expiresAt) <= Date.now());
          if (prior && prior.userId !== operation.userId) throw new Error();
          if (previous.success && (prior!.version > result.version || BigInt(previous.data.usedBytes) > BigInt(result.usedBytes)
            || previous.data.usageHistoryVersion > result.usageHistoryVersion
            || BigInt(previous.data.totalBytes) > BigInt(result.totalBytes) || Date.parse(previous.data.expiresAt) > Date.parse(result.expiresAt))) throw new Error();
          if (!prior) await tx.websiteServiceReference.create({ data: { userId: operation.userId, externalId: result.id, version: result.version, snapshot: result } });
          else if (prior.version <= result.version) await tx.websiteServiceReference.update({ where: { id: prior.id }, data: { version: result.version, snapshot: result, capturedAt: new Date() } });
          await tx.websiteOperation.update({ where: { id: operation.id }, data: { state: "SUCCEEDED", candidateKeyId: operation.kind === "REPLACEMENT" ? result.keyId : undefined, version: { increment: 1 } } });
          if (operation.orderId) await tx.websiteOrder.update({ where: { id: operation.orderId, userId: operation.userId, payment: "CONFIRMED" }, data: { state: "COMPLETE", provisioning: "SUCCEEDED", version: { increment: 1 } } });
          if (operation.issueId) await tx.supportIssue.update({ where: { id: operation.issueId, userId: operation.userId }, data: { state: "RESOLVED", version: { increment: 1 } } });
          await queueNotice(tx, { userId: operation.userId, audience: "CUSTOMER", kind: operation.kind === "REPLACEMENT" ? "KEY_REPLACED" : reactivated ? "SERVICE_REACTIVATED" : prior ? "SERVICE_RENEWED" : "SERVICE_ACTIVATED", dedupeKey: `operation:${operation.id}`, href: "/dashboard/secure-access", payload: { title: operation.kind === "REPLACEMENT" ? "Your Secure Access key was replaced" : reactivated ? "Your Secure Access is active again" : prior ? "Your Secure Access renewal is complete" : "Your Secure Access is ready", message: operation.kind === "REPLACEMENT" ? "Your old key has been revoked. Open Metro to securely retrieve the new key. Your consumed data, remaining quota and exact expiry were preserved." : "Activation or renewal completed with a verified finite data limit at the recorded time. Open Metro for current data, expiry and connection instructions.", action: "Open Secure Access", observedAt: result.observedAt ?? new Date().toISOString() } });
          await tx.websiteOutboxEvent.update({ where: { id: event.id, leaseId: lease }, data: { state: "DELIVERED", leaseId: null, leaseUntil: null, version: { increment: 1 } } });
        });
        return { status: "DELIVERED" as const };
      } catch (error) {
        const code = error instanceof WorkerReviewError ? error.reason : error && typeof error === "object" && "code" in error && /^P[0-9]{4}$/.test(String(error.code)) ? String(error.code) : "UNAVAILABLE";
        const cause = error && typeof error === "object" && "meta" in error ? (error.meta as { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } })?.driverAdapterError?.cause : undefined;
        const sqlState = /^[0-9A-Z]{5}$/.test(cause?.originalCode ?? "") ? cause?.originalCode : undefined;
        const deniedTable = /^permission denied for table ([a-z_]+)$/.exec(cause?.originalMessage ?? "")?.[1];
        console.error(JSON.stringify({ component: "metro-commerce-worker", event: "OPERATION_NOT_COMPLETED", stage, code, sqlState, deniedTable }));
        await transaction(async tx => {
          const changed = await tx.websiteOutboxEvent.updateMany({ where: { id: event.id, leaseId: lease, state: "LEASED" }, data: { state: "PENDING", leaseId: null, leaseUntil: null, availableAt: new Date(Date.now() + Math.min(3600, 5 * 2 ** Math.min(event.attempts, 9)) * 1000), version: { increment: 1 } } });
          if (changed.count) {
            const review = error instanceof WorkerReviewError || event.attempts >= 8;
            await tx.websiteOperation.updateMany({ where: { id: operation.id, state: { not: "SUCCEEDED" } }, data: { state: review ? "REVIEW_REQUIRED" : "RETRY_PENDING", version: { increment: 1 } } });
            if (operation.orderId) await tx.websiteOrder.updateMany({ where: { id: operation.orderId, payment: "CONFIRMED", state: "FULFILMENT_PENDING" }, data: { state: review ? "REVIEW_REQUIRED" : "FULFILMENT_PENDING", provisioning: review ? "REVIEW_REQUIRED" : "RETRY_PENDING", version: { increment: 1 } } });
            if (review) {
              const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
              const href = operation.orderId ? `/admin/orders/${operation.orderId}` : `/admin/support/${operation.issueId}`;
              if (binding) await queueNotice(tx, { userId: binding.userId, audience: "OWNER", kind: "FULFILMENT_REVIEW_REQUIRED", dedupeKey: `review:${operation.id}`, href, payload: { title: "VPN operation needs manual review", message: "Automatic processing stopped safely. Inspect the durable operation, authorization and authoritative backend outcome before retrying. No payment decision was changed.", action: "Review operation", observedAt: new Date().toISOString() } });
              await queueNotice(tx, { userId: operation.userId, audience: "CUSTOMER", kind: "FULFILMENT_REVIEW_REQUIRED", dedupeKey: `customer-review:${operation.id}`, href: operation.orderId ? `/dashboard/orders/${operation.orderId}` : "/dashboard/secure-access", payload: { title: "Your VPN operation needs Metro review", message: "Automatic activation or replacement could not be verified. Metro needs to review it; this notice does not confirm activation or change your payment decision.", action: "View status", observedAt: new Date().toISOString() } });
            }
          }
        });
        return { status: error instanceof WorkerReviewError || event.attempts >= 8 ? "REVIEW_REQUIRED" as const : "RETRY_PENDING" as const };
      }
    },
    async refreshServices(limit = 100) {
      if (!active(observationEnabled)) return;
      const services = await db.websiteServiceReference.findMany({ take: limit, orderBy: { capturedAt: "asc" } });
      for (const service of services) {
        try {
          const result = entitlementSchema.parse(await transport("entitlement", { owner: { issuer: "metro-website", subject: service.userId }, entitlementId: service.externalId }));
          if (result.id !== service.externalId || result.owner.subject !== service.userId || result.version !== service.version || !result.observedAt || Date.now() - Date.parse(result.observedAt) > 120000 || Date.parse(result.observedAt) > Date.now() + 5000) throw new Error("Invalid service observation.");
          await transaction(async tx => {
            const current = await tx.websiteServiceReference.findFirst({ where: { id: service.id, userId: service.userId } });
            if (!current || current.version > result.version) return;
            const prior = entitlementSchema.parse(current.snapshot);
            if (BigInt(prior.usedBytes) > BigInt(result.usedBytes) || result.usageHistoryVersion < prior.usageHistoryVersion || result.totalBytes !== prior.totalBytes || result.expiresAt !== prior.expiresAt || result.keyId !== prior.keyId || result.packageId !== prior.packageId) throw new Error("Entitlement receipt required for a mutation.");
            await tx.websiteServiceReference.update({ where: { id: service.id, userId: service.userId }, data: { version: result.version, snapshot: result as Prisma.InputJsonValue, capturedAt: new Date() } });
            const notice = statusNotice(service.userId, service.id, result, Date.now()); if (notice) await queueNotice(tx, notice);
          });
        } catch {
          // Preserve the prior observation, never invent zero usage or a revoked
          // key. A durable OWNER notice exposes retries without a second engine.
          await transaction(async tx => {
            const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
            if (binding) await queueNotice(tx, { userId: binding.userId, audience: "OWNER", kind: "SERVICE_OBSERVATION_UNAVAILABLE", dedupeKey: `observation:${service.id}:${service.capturedAt.toISOString()}`, href: `/admin/vpn/${service.id}`, payload: { title: "VPN usage or enforcement could not be verified", message: "The previous observation was retained and refresh will retry. Connect remains blocked without a fresh authoritative verification. Inspect backend enforcement health; this does not confirm revocation.", action: "Inspect service", observedAt: new Date().toISOString() } });
          });
        }
      }
    },
  };
}
export function productionFulfilmentWorker(db: PrismaClient) { return buildFulfilmentWorker(db, callVpnService, () => fulfilmentEnabled(), () => process.env.METRO_VPN_OBSERVATION_ENABLED === "true"); }
