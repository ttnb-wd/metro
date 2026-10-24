import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/server/db/generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildRepositories } from "../src/server/website/repositories.ts";
import { buildAdminRepository } from "../src/server/admin/repository.ts";
import { queueNotice } from "../src/server/notifications/store.ts";
import { statusNotice } from "../src/server/notifications/policy.ts";
import { buildNotificationWorker } from "../src/server/notifications/worker.ts";
import { buildFulfilmentWorker } from "../src/server/commerce/worker.ts";
import { serviceStatus } from "../src/features/workspace/service-status.ts";
import type { Entitlement } from "../src/server/vpn/contracts.ts";

const names = ["METRO_DISPOSABLE_BOOTSTRAP_URL", "METRO_DISPOSABLE_APP_URL", "METRO_DISPOSABLE_WORKER_URL", "METRO_DISPOSABLE_NOTIFIER_URL"];
for (const name of names) { const u = new URL(process.env[name]!); if (u.hostname !== "127.0.0.1" || !/^\/metro_disposable_[a-f0-9]{16}$/.test(u.pathname)) throw Error("Owned disposable runner required."); }
const [admin, app, workerDb, notifier] = names.map(name => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env[name]!, max: 4 }), log: [] }));
const owner = randomUUID(), customer = randomUUID(), stranger = randomUUID(), serviceId = randomUUID();
for (const id of [owner, customer, stranger]) await admin.user.create({ data: { id, name: "Disposable notification fixture", email: `${id}@example.invalid`, emailVerified: true } });
await admin.ownerBinding.create({ data: { slot: 1, userId: owner } });
async function reader(userId: string) { const session = await admin.session.create({ data: { userId, token: randomUUID(), createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) } }); return async () => ({ user: { id: userId, emailVerified: true }, session }); }
const customerRepo = buildRepositories(app, await reader(customer)), ownerRepo = buildRepositories(app, await reader(owner)), otherRepo = buildRepositories(app, await reader(stranger));
let live: Entitlement = { id: randomUUID(), owner: { issuer: "metro-website", subject: customer }, packageId: randomUUID(), version: 0, status: "ACTIVE", keyId: "mw-" + "a".repeat(48), keyStatus: "ENFORCED", expiresAt: new Date(Date.now() + 86400000).toISOString(), totalBytes: "2147483648", usedBytes: "1610612736", remainingBytes: "536870912", usageHistoryVersion: 0, observedAt: new Date().toISOString() };
await admin.websiteServiceReference.create({ data: { id: serviceId, userId: customer, externalId: live.id, version: live.version, snapshot: live } });
const meta = () => ({ requestId: randomUUID(), idempotencyKey: randomUUID() });

test("one durable low-data warning under concurrent refresh; read/unread ownership isolation", async () => {
  const draft = statusNotice(customer, serviceId, live, Date.now())!;
  await Promise.all(Array.from({ length: 6 }, () => admin.$transaction(tx => queueNotice(tx, draft, true))));
  assert.equal(await admin.websiteNotification.count({ where: { dedupeKey: draft.dedupeKey } }), 1);
  assert.equal(await admin.websiteNotification.count({ where: { dedupeKey: draft.dedupeKey, emailState: "PENDING" } }), 1);
  const inbox = await customerRepo.notifications(); assert.equal(inbox.unread, 1); assert.equal((await otherRepo.notifications()).items.length, 0);
  const id = inbox.items[0].id; await assert.rejects(otherRepo.readNotification(id, true)); await customerRepo.readNotification(id, true); assert.equal((await customerRepo.notifications()).unread, 0); await customerRepo.readNotification(id, false); assert.equal((await customerRepo.notifications()).unread, 1);
});
test("SMTP retry and success cannot mutate subscription or disclose auth data to worker", async () => {
  const before = await admin.websiteServiceReference.findUniqueOrThrow({ where: { id: serviceId } }); let calls = 0;
  const delivery = buildNotificationWorker(notifier, "https://metro.example", async () => ++calls === 1 ? "RETRY" : "SENT", true, async () => ({ entitlement: live, status: serviceStatus(live) }));
  assert.equal((await delivery.runOne()).status, "RETRY");
  await admin.websiteNotification.updateMany({ where: { emailState: "RETRY" }, data: { emailAvailableAt: new Date(0) } });
  assert.equal((await delivery.runOne()).status, "SENT"); assert.equal(calls, 2); assert.deepEqual(await admin.websiteServiceReference.findUniqueOrThrow({ where: { id: serviceId } }), before);
  await assert.rejects((buildAdminRepository(app, await reader(customer))).notificationDelivery()); await assert.rejects(notifier.websiteOutboxEvent.findMany()); await assert.rejects(notifier.account.findMany()); await assert.rejects(notifier.session.findMany()); await assert.rejects(notifier.ownerBinding.findMany()); await assert.rejects(notifier.websiteOrder.updateMany({ data: { payment: "CONFIRMED" } }));
});
test("a lost SMTP confirmation is quarantined and never resent automatically", async () => {
  await admin.$transaction(tx => queueNotice(tx, { userId: customer, audience: "CUSTOMER", kind: "SUPPORT_UPDATED", dedupeKey: "uncertain:" + randomUUID(), href: "/dashboard/secure-access", payload: { title: "Support update", message: "Test fixture only", action: "Open Metro", observedAt: new Date().toISOString() } }, true));
  const notice = await admin.websiteNotification.findFirstOrThrow({ where: { emailState: "PENDING" } }); await admin.websiteNotification.update({ where: { id: notice.id }, data: { emailState: "SENDING", emailLeaseId: randomUUID(), emailLeaseUntil: new Date(0) } });

  let calls = 0; const delivery = buildNotificationWorker(notifier, "https://metro.example", async () => { calls++; return "SENT"; }, true);
  await delivery.runOne(); assert.equal(calls, 0); assert.equal((await admin.websiteNotification.findUniqueOrThrow({ where: { id: notice.id } })).emailState, "UNCERTAIN"); await delivery.runOne(); assert.equal(calls, 0);
});
test("support creates OWNER notification; CUSTOMER cannot diagnose or replace; three retries are enforced", async () => {
  const issue = await customerRepo.reportIssue({ serviceId, category: "CANNOT_CONNECT", description: "Disposable connection issue" }, meta());
  assert.ok((await ownerRepo.notifications()).items.some(item => item.href === `/admin/support/${issue.id}`));
  await assert.rejects(customerRepo.recordDiagnosis({ userId: customer, issueId: issue.id, version: 0, result: "SUCCEEDED" }, meta()));
  await ownerRepo.recordDiagnosis({ userId: customer, issueId: issue.id, version: 0, result: "SUCCEEDED" }, meta());
  for (let attempt = 0; attempt < 3; attempt++) await customerRepo.recordRetry({ issueId: issue.id, version: attempt + 1, expectedAttempt: attempt, result: "FAILED" }, meta());
  await assert.rejects(customerRepo.recordRetry({ issueId: issue.id, version: 4, expectedAttempt: 3, result: "FAILED" }, meta()));
  assert.equal((await admin.supportIssue.findUniqueOrThrow({ where: { id: issue.id } })).state, "REVIEW_REQUIRED");
});
test("same-key renewal and controlled replacement produce one notice per durable operation with preserved history", async () => {
  live = { ...live, usedBytes: live.totalBytes, remainingBytes: "0", status: "QUOTA_EXHAUSTED", keyStatus: "BLOCKED" };
  await admin.websiteServiceReference.update({ where: { id: serviceId }, data: { snapshot: live } });
  const quoteId = randomUUID(); const order = await admin.websiteOrder.create({ data: { userId: customer, quoteId, quoteSnapshot: { owner: { issuer: "metro-website", subject: customer }, id: quoteId, totalMmk: "1", pricingVersion: 1, months: 1, durationDays: 30, packageId: live.packageId, quotaBytes: "1073741824" }, totalMmk: "1", state: "FULFILMENT_PENDING", payment: "CONFIRMED", provisioning: "QUEUED" } });
  const operation = await admin.websiteOperation.create({ data: { userId: customer, kind: "PROVISION", resourceKey: order.id, orderId: order.id, frozenSnapshot: order.quoteSnapshot } });
  await admin.websiteOutboxEvent.create({ data: { userId: customer, operationId: operation.id, topic: "VPN_FULFILMENT_REQUESTED", businessKey: `fulfil:${order.id}`, resourceId: order.id } });
  const evidence = await admin.paymentEvidence.create({data:{orderId:order.id,userId:customer,storageRef:randomUUID(),sha256:"a".repeat(64),mediaType:"image/png",bytes:100}});
  await admin.paymentDecision.create({data:{orderId:order.id,userId:customer,evidenceId:evidence.id,decision:"APPROVED",verificationRef:randomUUID(),amountMmk:"1",ownerId:owner,reasonCode:"PAYMENT_MATCHED"}});
  await admin.websiteAuditEvent.create({data:{actorId:owner,targetUserId:customer,action:"PAYMENT_DECISION",outcome:"SUCCESS",resourceId:order.id,reasonCode:"PAYMENT_MATCHED",requestId:randomUUID(),idempotencyKey:randomUUID()}});
  const old = structuredClone(live); live = { ...live, version: 1, status: "ACTIVE", keyStatus: "ENFORCED", totalBytes: "3221225472", remainingBytes: "1073741824", expiresAt: new Date(Date.parse(live.expiresAt) + 30 * 86400000).toISOString(), usageHistoryVersion: 1, observedAt: new Date().toISOString() };
  let receiptBefore=old;
  const worker = buildFulfilmentWorker(workerDb, async (action,input) => {const request=input as {operationId:string};const appliedAt=new Date().toISOString();live={...live,observedAt:appliedAt};return {protocol:'metro-fulfilment-receipt.v1',operationId:request.operationId,kind:action==='replace'?'REPLACEMENT':'PROVISION',orderId:action==='replace'?null:order.id,quoteId:action==='replace'?null:quoteId,quoteVersion:action==='replace'?null:1,appliedAt,completedAt:appliedAt,purchase:action==='replace'?null:{packageId:live.packageId,quotaBytes:String(BigInt(live.totalBytes)-BigInt(receiptBefore.totalBytes)),months:1,durationDays:30},enforcement:{counterBytes:action==='replace'?'0':live.usedBytes,windowBytes:action==='replace'?'0':live.usedBytes,counterEpoch:'fixture',verifiedAt:appliedAt},before:receiptBefore,entitlement:live,usageOffsetBytes:action==='replace'?receiptBefore.usedBytes:'0',previousUsageOffsetBytes:'0',verifiedFiniteLimitBytes:action==='replace'?receiptBefore.remainingBytes:live.totalBytes,oldKeyId:action==='replace'?receiptBefore.keyId:null,oldKeyRevoked:action==='replace'}}, true); assert.equal((await worker.runOne()).status, "DELIVERED"); await worker.runOne();
  assert.equal(await admin.websiteNotification.count({ where: { dedupeKey: `operation:${operation.id}`, kind: "SERVICE_REACTIVATED" } }), 1); assert.equal(live.keyId, old.keyId); assert.equal(live.usedBytes, old.usedBytes);
  const issue = await customerRepo.reportIssue({ serviceId, category: "CANNOT_CONNECT", description: "Disposable replacement check" }, meta()); await ownerRepo.recordDiagnosis({ userId: customer, issueId: issue.id, version: 0, result: "FAILED" }, meta());
  await assert.rejects(customerRepo.requestReplacement({ userId: customer, serviceId, issueId: issue.id, expectedVersion: 1 }, meta()));
  const queued = await ownerRepo.requestReplacement({ userId: customer, serviceId, issueId: issue.id, expectedVersion: 1 }, meta()), before = structuredClone(live);
  receiptBefore=before;
  live = { ...live, version: 2, keyId: "mw-" + "b".repeat(48), usageHistoryVersion: 2, observedAt: new Date().toISOString() };
  assert.equal((await worker.runOne()).status, "DELIVERED"); assert.equal(await admin.websiteNotification.count({ where: { dedupeKey: `operation:${queued.id}`, kind: "KEY_REPLACED" } }), 1);
  assert.equal(live.usedBytes, before.usedBytes); assert.equal(live.remainingBytes, before.remainingBytes); assert.equal(live.expiresAt, before.expiresAt); assert.notEqual(live.keyId, before.keyId);
});
test("snapshot refresh continues after one unavailable customer; duplicate status warnings stay unique", async () => {
  const externalId = randomUUID(), brokenSnapshot = { ...live, id: externalId, version: 0, owner: { issuer: "metro-website" as const, subject: stranger } }; const broken = await admin.websiteServiceReference.create({ data: { userId: stranger, externalId, version: 0, snapshot: brokenSnapshot } });
  live = { ...live, remainingBytes: "1", usedBytes: (BigInt(live.totalBytes) - BigInt(1)).toString(), observedAt: new Date().toISOString() };
  const worker = buildFulfilmentWorker(workerDb, async (_action, input) => { if ((input as { owner: { subject: string } }).owner.subject === stranger) throw Error(); return live; }, true);
  await worker.refreshServices(); await worker.refreshServices(); const draft = statusNotice(customer, serviceId, live, Date.now())!;
  assert.equal(await admin.websiteNotification.count({ where: { dedupeKey: draft.dedupeKey } }), 1); assert.deepEqual((await admin.websiteServiceReference.findUniqueOrThrow({ where: { id: broken.id } })).snapshot, brokenSnapshot);
});
test("obsolete warnings are suppressed after top-up and unknown usage is retried without an email", async () => {
  await admin.websiteNotification.updateMany({ where: { emailState: { in: ["PENDING", "RETRY"] } }, data: { emailState: "SUPPRESSED" } });
  const draft = statusNotice(customer, serviceId, live, Date.now())!;
  await admin.$transaction(tx => queueNotice(tx, { ...draft, dedupeKey: `status:${serviceId}:999:LOW_DATA` }, true));
  let calls = 0; const delivery = buildNotificationWorker(notifier, "https://metro.example", async () => { calls++; return "SENT"; }, true, async () => ({ entitlement: live, status: serviceStatus(live) }));
  assert.equal((await delivery.runOne()).status, "SUPPRESSED"); assert.equal(calls, 0);
  await admin.$transaction(tx => queueNotice(tx, { ...draft, dedupeKey: `status:${serviceId}:998:LOW_DATA` }, true));
  const unavailable = buildNotificationWorker(notifier, "https://metro.example", async () => { calls++; return "SENT"; }, true, async () => ({ entitlement: null, status: serviceStatus(null) }));
  assert.equal((await unavailable.runOne()).status, "RETRY"); assert.equal(calls, 0);
});
test("concurrent delivery leases send only once; a definitive rejection leaves entitlements intact", async () => {
  await admin.websiteNotification.updateMany({ where: { emailState: { in: ["PENDING", "RETRY"] } }, data: { emailState: "SUPPRESSED" } });
  const make = (key: string) => admin.$transaction(tx => queueNotice(tx, { userId: customer, audience: "CUSTOMER", kind: "SERVICE_RENEWED", dedupeKey: key, href: "/dashboard/secure-access", payload: { title: "Renewal recorded", message: "Disposable fixture event only", action: "Open Metro", observedAt: new Date().toISOString() } }, true));
  await make(`concurrency:${randomUUID()}`); let calls = 0;
  const worker = buildNotificationWorker(notifier, "https://metro.example", async () => { calls++; await new Promise(resolve => setTimeout(resolve, 30)); return "SENT"; }, true);
  const result = await Promise.all([worker.runOne(), worker.runOne()]); assert.equal(calls, 1); assert.ok(result.some(row => row.status === "SENT"));
  const before = await admin.websiteServiceReference.findUniqueOrThrow({ where: { id: serviceId } });
  await make(`failure:${randomUUID()}`); assert.equal((await buildNotificationWorker(notifier, "https://metro.example", async () => "FAILED", true).runOne()).status, "FAILED");
  assert.deepEqual(await admin.websiteServiceReference.findUniqueOrThrow({ where: { id: serviceId } }), before);
});
after(async () => { for (const db of [notifier, workerDb, app, admin]) await db.$disconnect(); });
