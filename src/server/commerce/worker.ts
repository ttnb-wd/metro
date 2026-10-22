import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../db/generated/client";
import { entitlementSchema } from "../vpn/contracts";
import { fulfilmentEnabled } from "./config";
import { callVpnService } from "../vpn/transport";
import { queueNotice } from "../notifications/store";
import { statusNotice } from "../notifications/policy";

type Transport = (action: "fulfil" | "replace" | "entitlement", input: object) => Promise<unknown>;
/** Dedicated process/role, not a public cron endpoint or a customer session. */
export function buildFulfilmentWorker(db: PrismaClient, transport: Transport, enabled: boolean) {
  return {
    async runOne() {
      if (!enabled) return { status: "DISABLED" as const };
      const lease = randomUUID();
      const event = await db.$transaction(async tx => {
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
      try {
        await db.websiteOperation.updateMany({ where: { id: operation.id, state: { in: ["QUEUED", "RETRY_PENDING", "PROCESSING"] } }, data: { state: "PROCESSING", version: { increment: 1 } } });
        const snapshot = operation.frozenSnapshot as Record<string, unknown>;
        const owner = { issuer: "metro-website", subject: operation.userId };
        const result = entitlementSchema.parse(await transport(operation.kind === "REPLACEMENT" ? "replace" : "fulfil", operation.kind === "REPLACEMENT" ? { owner, operationId: operation.id, issueId: operation.issueId, entitlementId: snapshot.id, expectedVersion: operation.expectedVersion, failureVerified: true } : { owner, operationId: operation.id, orderId: operation.orderId, quote: snapshot }));
        if (result.owner.subject !== operation.userId || result.owner.issuer !== owner.issuer || result.status !== "ACTIVE" || result.keyStatus !== "ENFORCED" || !result.keyId || new Date(result.expiresAt).getTime() <= Date.now()) throw new Error();
        if (operation.kind === "PROVISION" && (result.packageId !== snapshot.packageId || BigInt(result.totalBytes) < BigInt(String(snapshot.quotaBytes)))) throw new Error();
        if (operation.kind === "REPLACEMENT" && (result.id !== snapshot.id || result.keyId === snapshot.keyId || result.expiresAt !== snapshot.expiresAt || result.totalBytes !== snapshot.totalBytes || BigInt(result.usedBytes) < BigInt(String(snapshot.usedBytes)))) throw new Error();
        await db.$transaction(async tx => {
          const owned = await tx.websiteOutboxEvent.findFirst({ where: { id: event.id, state: "LEASED", leaseId: lease, leaseUntil: { gt: new Date() } } });
          if (!owned) throw new Error();
          const prior = await tx.websiteServiceReference.findUnique({ where: { externalId: result.id } });
          const previous = entitlementSchema.safeParse(prior?.snapshot);
          const reactivated = previous.success && (BigInt(previous.data.remainingBytes) === BigInt(0) || Date.parse(previous.data.expiresAt) <= Date.now());
          if (prior && prior.userId !== operation.userId) throw new Error();
          if (!prior) await tx.websiteServiceReference.create({ data: { userId: operation.userId, externalId: result.id, version: result.version, snapshot: result } });
          else if (prior.version <= result.version) await tx.websiteServiceReference.update({ where: { id: prior.id }, data: { version: result.version, snapshot: result, capturedAt: new Date() } });
          await tx.websiteOperation.update({ where: { id: operation.id }, data: { state: "SUCCEEDED", candidateKeyId: operation.kind === "REPLACEMENT" ? result.keyId : undefined, version: { increment: 1 } } });
          if (operation.orderId) await tx.websiteOrder.update({ where: { id: operation.orderId, userId: operation.userId, payment: "CONFIRMED" }, data: { state: "COMPLETE", provisioning: "SUCCEEDED", version: { increment: 1 } } });
          if (operation.issueId) await tx.supportIssue.update({ where: { id: operation.issueId, userId: operation.userId }, data: { state: "RESOLVED", version: { increment: 1 } } });
          await queueNotice(tx, { userId: operation.userId, audience: "CUSTOMER", kind: operation.kind === "REPLACEMENT" ? "KEY_REPLACED" : reactivated ? "SERVICE_REACTIVATED" : prior ? "SERVICE_RENEWED" : "SERVICE_ACTIVATED", dedupeKey: `operation:${operation.id}`, href: "/dashboard/secure-access", payload: { title: operation.kind === "REPLACEMENT" ? "Your Secure Access key was replaced" : reactivated ? "Your Secure Access is active again" : prior ? "Your Secure Access renewal is complete" : "Your Secure Access is ready", message: operation.kind === "REPLACEMENT" ? "Your old key has been revoked. Open Metro to securely retrieve the new key. Your consumed data, remaining quota and exact expiry were preserved." : "Activation or renewal completed with a verified finite data limit at the recorded time. Open Metro for current data, expiry and connection instructions.", action: "Open Secure Access", observedAt: result.observedAt ?? new Date().toISOString() } });
          await tx.websiteOutboxEvent.update({ where: { id: event.id, leaseId: lease }, data: { state: "DELIVERED", leaseId: null, leaseUntil: null, version: { increment: 1 } } });
        });
        return { status: "DELIVERED" as const };
      } catch {
        await db.$transaction(async tx => {
          const changed = await tx.websiteOutboxEvent.updateMany({ where: { id: event.id, leaseId: lease, state: "LEASED" }, data: { state: "PENDING", leaseId: null, leaseUntil: null, availableAt: new Date(Date.now() + Math.min(3600, 5 * 2 ** Math.min(event.attempts, 9)) * 1000), version: { increment: 1 } } });
          if (changed.count) {
            const review = event.attempts >= 8;
            await tx.websiteOperation.updateMany({ where: { id: operation.id, state: { not: "SUCCEEDED" } }, data: { state: review ? "REVIEW_REQUIRED" : "RETRY_PENDING", version: { increment: 1 } } });
            if (operation.orderId) await tx.websiteOrder.updateMany({ where: { id: operation.orderId, payment: "CONFIRMED", state: "FULFILMENT_PENDING" }, data: { state: review ? "REVIEW_REQUIRED" : "FULFILMENT_PENDING", provisioning: review ? "REVIEW_REQUIRED" : "RETRY_PENDING", version: { increment: 1 } } });
          }
        });
        return { status: "RETRY_PENDING" as const };
      }
    },
    async refreshServices(limit = 100) {
      if (!enabled) return;
      const services = await db.websiteServiceReference.findMany({ take: limit, orderBy: { capturedAt: "asc" } });
      for (const service of services) {
        try {
          const result = entitlementSchema.parse(await transport("entitlement", { owner: { issuer: "metro-website", subject: service.userId }, entitlementId: service.externalId }));
          if (result.id !== service.externalId || result.owner.subject !== service.userId || result.version < service.version) throw new Error("Invalid service ownership.");
          await db.$transaction(async tx => {
            const current = await tx.websiteServiceReference.findFirst({ where: { id: service.id, userId: service.userId } });
            if (!current || current.version > result.version) return;
            const prior = entitlementSchema.parse(current.snapshot);
            if (BigInt(prior.usedBytes) > BigInt(result.usedBytes)) throw new Error("Usage cannot decrease.");
            await tx.websiteServiceReference.update({ where: { id: service.id, userId: service.userId }, data: { version: result.version, snapshot: result as Prisma.InputJsonValue, capturedAt: new Date() } });
            const notice = statusNotice(service.userId, service.id, result, Date.now()); if (notice) await queueNotice(tx, notice);
          });
        } catch { /* Preserve the previous observation, which naturally becomes stale. Continue other customers. */ }
      }
    },
  };
}
export function productionFulfilmentWorker(db: PrismaClient) { return buildFulfilmentWorker(db, callVpnService, fulfilmentEnabled()); }
