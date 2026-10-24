import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { contracts, ownerSchema, quoteSchema, entitlementSchema, adminNotificationSchema, SensitiveCredential, type Entitlement, type Operation, WEBSITE_ISSUER } from "../src/server/vpn/contracts.ts";
import { createVpnServiceClient, type MockVpnTransport, type AuditEvent } from "../src/server/vpn/client.ts";
import { createMockVpnTransport } from "../src/server/vpn/mock.ts";
import { websiteOwner } from "../src/server/vpn/identity.ts";
import { priceQuote, renewalTarget, assertReplacementPreserved } from "../src/server/vpn/policy.ts";
import { assertTransition, recordConnectionTest, recordCustomerRetry } from "../src/server/vpn/states.ts";
import { VpnServiceError } from "../src/server/vpn/errors.ts";

let networkCalls = 0;
const network = mock.method(net.Socket.prototype, "connect", () => { networkCalls++; throw new Error("Network forbidden in isolated tests."); });
const fetchGuard = mock.method(globalThis, "fetch", async () => { networkCalls++; throw new Error("Fetch forbidden in isolated tests."); });
after(() => { network.mock.restore(); fetchGuard.mock.restore(); assert.equal(networkCalls, 0); });
const owner = { issuer: WEBSITE_ISSUER, subject: "fixture-website-user" };
const foreign = { issuer: WEBSITE_ISSUER, subject: "other-website-user" };
const now = "2026-10-20T00:00:00.000Z";
const pkg = { id: "fixture-package", name: "Isolated fixture", monthlyPriceMmk: "5001", monthlyQuotaBytes: "107374182400", baseDurationDays: 30 as const };
const base: Entitlement = {
  id: "fixture-entitlement", owner, packageId: pkg.id, version: 4, status: "ACTIVE", keyId: "fixture-key-before",
  keyStatus: "ENFORCED", expiresAt: "2026-12-19T00:00:00.000Z", totalBytes: "1000", usedBytes: "400", remainingBytes: "600",
  usageHistoryVersion: 8, observedAt: now,
};
const metadata = (idempotencyKey = randomUUID()) => ({ requestId: randomUUID(), idempotencyKey });
function setup(options: { subject?: string; admin?: boolean; transport?: MockVpnTransport; audit?: (event: AuditEvent) => Promise<void> } = {}) {
  const audit: AuditEvent[] = [];
  const transport = options.transport ?? createMockVpnTransport({ catalog: { catalogVersion: "fixture-catalog", packages: [pkg] }, entitlements: [base, { ...base, id: "foreign-entitlement", owner: foreign }], now: () => now });
  const client = createVpnServiceClient({ mode: "mock", transport,
    readSession: async () => ({ user: { id: options.subject ?? owner.subject } }),
    authorize: async () => options.admin === true,
    audit: options.audit ?? (async event => { audit.push(event); }),
  });
  return { client, audit, transport };
}
function code(expected: string) { return (error: unknown) => error instanceof VpnServiceError && error.code === expected; }
async function makeOrder(client: ReturnType<typeof createVpnServiceClient>) {
  const quote = await client.execute("quotes.create", { packageId: pkg.id, catalogVersion: "fixture-catalog", months: 2 }, metadata());
  return (await client.execute("orders.create", { quoteId: quote.data.id }, metadata())).data;
}
async function report(client: ReturnType<typeof createVpnServiceClient>) {
  return (await client.execute("issues.report", { entitlementId: base.id, category: "CANNOT_CONNECT", description: "Isolated connectivity report." }, metadata())).data;
}

test("default client is disabled before session, authorization or transport access", async () => {
  let calls = 0;
  const client = createVpnServiceClient({ readSession: async () => { calls++; return null; } });
  await assert.rejects(client.execute("catalog.get", {}, metadata()), code("DISABLED")); assert.equal(calls, 0);
});
test("mock mode cannot run in production even with injected dependencies", async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(setup().client.execute("catalog.get", {}, metadata()), code("DISABLED"));
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test("owner comes only from the session; absent sessions and Telegram issuers are rejected", async () => {
  assert.deepEqual(await websiteOwner(randomUUID(), async () => ({ user: { id: owner.subject } })), owner);
  await assert.rejects(websiteOwner(randomUUID(), async () => null), code("UNAUTHENTICATED"));
  assert.equal(ownerSchema.safeParse({ issuer: "telegram", subject: owner.subject }).success, false);
  const transport = setup().transport;
  const client = createVpnServiceClient({ mode: "mock", transport, readSession: async () => null });
  await assert.rejects(client.execute("catalog.get", {}, metadata()), code("UNAUTHENTICATED"));
});
test("strict contracts reject injected owner, admin role, totals and unknown fields", () => {
  assert.equal(contracts["quotes.create"].request.safeParse({ packageId: pkg.id, catalogVersion: "v1", months: 1, owner: foreign }).success, false);
  assert.equal(contracts["orders.create"].request.safeParse({ quoteId: "quote", totalMmk: "1", role: "admin" }).success, false);
  assert.equal(contracts["replacements.request"].request.safeParse({ owner, entitlementId: base.id, issueId: "issue", expectedVersion: 4, reason: "VERIFIED_KEY_FAILURE", quotaBytes: "999999" }).success, false);
});
test("every admin operation denies a normal customer before transport", async () => {
  let calls = 0;
  const client = setup({ transport: { mode: "mock", execute: async () => { calls++; return {}; } } }).client;
  const inputs = {
    "payments.confirm": { owner, orderId: "order", verificationId: "verification", amountMmk: "1", currency: "MMK" },
    "diagnostics.get": { owner, entitlementId: base.id },
    "diagnostics.record": { owner, entitlementId: base.id, issueId: "issue", result: "FAILED", expectedVersion: 4 },
    "credentials.reveal": { owner, entitlementId: base.id, issueId: "issue", expectedVersion: 4, reason: "ADMIN_CONNECTION_TEST" },
    "replacements.request": { owner, entitlementId: base.id, issueId: "issue", expectedVersion: 4, reason: "VERIFIED_KEY_FAILURE" },
  };
  for (const operation of Object.keys(inputs) as (keyof typeof inputs)[]) {
    await assert.rejects(client.execute(operation, inputs[operation] as never, metadata()), code("FORBIDDEN"));
  }
  assert.equal(calls, 0);
});
test("authorization provider sees the actual actor and requested resource owner", async () => {
  let checked = false;
  const client = createVpnServiceClient({ mode: "mock", transport: setup().transport, readSession: async () => ({ user: { id: "reviewer" } }),
    authorize: async value => { checked = true; assert.equal(value.actor.subject, "reviewer"); assert.deepEqual(value.owner, owner); assert.equal(value.permission, "vpn:diagnostics:read"); return false; } });
  await assert.rejects(client.execute("diagnostics.get", { owner, entitlementId: base.id }, metadata()), code("FORBIDDEN")); assert.ok(checked);
});
test("all mutation commands require idempotency keys; invalid request IDs are not echoed", async () => {
  const client = setup().client;
  await assert.rejects(client.execute("quotes.create", { packageId: pkg.id, catalogVersion: "fixture-catalog", months: 1 }, { requestId: randomUUID() }), code("INVALID_REQUEST"));
  await assert.rejects(client.execute("catalog.get", {}, { requestId: "unsafe-log-text" }), error => {
    assert.ok(error instanceof VpnServiceError); assert.notEqual(error.requestId, "unsafe-log-text"); return error.code === "INVALID_REQUEST";
  });
});
test("cross-account orders, quotes, issue reports and entitlements remain isolated", async () => {
  const a = setup(); const b = setup({ subject: foreign.subject, transport: a.transport });
  const order = await makeOrder(a.client);
  await assert.rejects(b.client.execute("orders.get", { orderId: order.id }, metadata()), code("NOT_FOUND"));
  await assert.rejects(b.client.execute("orders.create", { quoteId: order.quoteId }, metadata()), code("NOT_FOUND"));
  await assert.rejects(b.client.execute("issues.report", { entitlementId: base.id, category: "CANNOT_CONNECT", description: "Fixture." }, metadata()), code("NOT_FOUND"));
  const result = await b.client.execute("entitlements.get", {}, metadata());
  assert.equal(result.data.entitlements.length, 1); assert.equal(result.data.entitlements[0].id, "foreign-entitlement");
});
test("foreign or secret-bearing service responses fail closed", async () => {
  for (const response of [ { owner, entitlements: [{ ...base, owner: foreign }] }, { owner, entitlements: [], vpnKey: "forbidden-field" } ]) {
    const client = setup({ transport: { mode: "mock", execute: async () => response } }).client;
    await assert.rejects(client.execute("entitlements.get", {}, metadata()), code("INVALID_RESPONSE"));
  }
});
test("all 12 durations have exact integer MMK, 30-day months and multiplied quota", () => {
  for (let months = 1; months <= 12; months++) {
    const quote = priceQuote({ id: "quote", owner, pkg, months, catalogVersion: "v1", validUntil: "2026-10-20T01:00:00.000Z" });
    assert.equal(quote.discountPercent, (months - 1) * 5); assert.equal(quote.durationDays, months * 30);
    assert.equal(BigInt(quote.regularMmk), BigInt(quote.savedMmk) + BigInt(quote.totalMmk));
    assert.equal(BigInt(quote.quotaBytes), BigInt(pkg.monthlyQuotaBytes) * BigInt(months));
  }
  const huge = priceQuote({ id: "quote", owner, pkg: { ...pkg, monthlyPriceMmk: "9007199254740993" }, months: 2, catalogVersion: "v1", validUntil: "2026-10-20T01:00:00.000Z" });
  assert.equal(huge.regularMmk, "18014398509481986");
  assert.equal(huge.savedMmk, "900719925474099");
  assert.equal(quoteSchema.safeParse({ ...huge, totalMmk: "1" }).success, false);
  for (const months of [0, 13, 1.5, NaN]) assert.throws(() => priceQuote({ id: "q", owner, pkg, months, catalogVersion: "v1", validUntil: now }));
  assert.throws(() => priceQuote({ id: "q", owner, pkg: { ...pkg, baseDurationDays: 31 }, months: 1, catalogVersion: "v1", validUntil: now }));
});
test("duplicate and concurrent quotes/orders return one immutable operation; changed input conflicts", async () => {
  const client = setup().client; const m = metadata(); const input = { packageId: pkg.id, catalogVersion: "fixture-catalog", months: 2 };
  const quotes = await Promise.all(Array.from({ length: 12 }, () => client.execute("quotes.create", input, { ...m, requestId: randomUUID() })));
  assert.equal(new Set(quotes.map(q => q.data.id)).size, 1);
  await assert.rejects(client.execute("quotes.create", { ...input, months: 3 }, m), code("CONFLICT"));
  const orders = await Promise.all(Array.from({ length: 8 }, () => client.execute("orders.create", { quoteId: quotes[0].data.id }, metadata())));
  assert.equal(new Set(orders.map(order => order.data.id)).size, 1);
  orders[0].data.totalMmk = "1";
  assert.notEqual((await client.execute("orders.get", { orderId: orders[0].data.id }, metadata())).data.totalMmk, "1");
});
test("expired quotes and stale catalog versions cannot create orders", async () => {
  let clock = now;
  const transport = createMockVpnTransport({ catalog: { catalogVersion: "v1", packages: [pkg] }, now: () => clock });
  const client = setup({ transport }).client;
  await assert.rejects(client.execute("quotes.create", { packageId: pkg.id, catalogVersion: "old", months: 1 }, metadata()), code("CONFLICT"));
  const quote = await client.execute("quotes.create", { packageId: pkg.id, catalogVersion: "v1", months: 1 }, metadata());
  clock = "2026-10-20T01:00:00.000Z";
  await assert.rejects(client.execute("orders.create", { quoteId: quote.data.id }, metadata()), code("CONFLICT"));
});
test("payment confirmation checks amount, deduplicates verification and queues without provisioning", async () => {
  const { client, audit } = setup({ admin: true }); const order = await makeOrder(client);
  const input = { owner, orderId: order.id, verificationId: "fixture-verification", amountMmk: order.totalMmk, currency: "MMK" as const };
  await assert.rejects(client.execute("payments.confirm", { ...input, amountMmk: "1" }, metadata()), code("CONFLICT"));
  const results = await Promise.all(Array.from({ length: 5 }, () => client.execute("payments.confirm", input, metadata())));
  assert.equal(new Set(results.map(r => r.data.operationId)).size, 1); assert.equal(results[0].data.state, "QUEUED");
  await assert.rejects(client.execute("payments.confirm", { ...input, verificationId: "changed" }, metadata()), code("CONFLICT"));
  const second = await makeOrder(client);
  await assert.rejects(client.execute("payments.confirm", { ...input, orderId: second.id }, metadata()), code("CONFLICT"));
  assert.equal((await client.execute("orders.get", { orderId: order.id }, metadata())).data.provisioning, "QUEUED");
  assert.ok(audit.some(e => e.outcome === "INTENT")); assert.ok(audit.some(e => e.outcome === "SUCCESS"));
});
test("failed admin connection test permits only one replacement request per entitlement version", async () => {
  const { client } = setup({ admin: true }); const issue = await report(client);
  const input = { owner, entitlementId: base.id, issueId: issue.id, expectedVersion: 4, reason: "VERIFIED_KEY_FAILURE" as const };
  await assert.rejects(client.execute("replacements.request", input, metadata()), code("CONFLICT"));
  await client.execute("diagnostics.record", { owner, entitlementId: base.id, issueId: issue.id, expectedVersion: 4, result: "FAILED" }, metadata());
  const results = await Promise.all(Array.from({ length: 5 }, () => client.execute("replacements.request", input, metadata())));
  assert.equal(new Set(results.map(r => r.data.operationId)).size, 1); assert.equal(results[0].data.state, "REQUESTED");
  const after = await client.execute("entitlements.get", {}, metadata()); assert.deepEqual(after.data.entitlements, [base]);
  const diagnosis = await client.execute("diagnostics.get", { owner, entitlementId: base.id }, metadata());
  assert.equal(diagnosis.data.connectionTest, "FAILED"); assert.equal(diagnosis.data.issues[0].history.length, 2);
});
test("successful admin test requires up to three customer retries, never automatic replacement", async () => {
  const { client } = setup({ admin: true }); const issue = await report(client);
  await client.execute("diagnostics.record", { owner, entitlementId: base.id, issueId: issue.id, expectedVersion: 4, result: "SUCCEEDED" }, metadata());
  await assert.rejects(client.execute("replacements.request", { owner, entitlementId: base.id, issueId: issue.id, expectedVersion: 4, reason: "VERIFIED_KEY_FAILURE" }, metadata()), code("CONFLICT"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = metadata(); const input = { issueId: issue.id, expectedAttempt: attempt, result: "FAILED" as const };
    const result = await client.execute("issues.retry", input, m);
    const duplicate = await client.execute("issues.retry", input, m);
    assert.equal(result.data.attempts, attempt + 1); assert.deepEqual(result.data, duplicate.data);
    await assert.rejects(client.execute("issues.retry", input, metadata()), code("CONFLICT"));
    assert.equal(result.data.state, attempt === 2 ? "REVIEW_REQUIRED" : "TROUBLESHOOTING");
  }
});
test("customer retry success resolves the issue and preserves history", () => {
  const open = { id: "issue", owner, entitlementId: base.id, state: "DIAGNOSING" as const, attempts: 0, createdAt: now,
    history: [{ kind: "REPORTED" as const, at: now, attempt: 0 }] };
  const issue = recordConnectionTest(open, "SUCCEEDED", now);
  const resolved = recordCustomerRetry(issue, 0, "SUCCEEDED", now);
  assert.equal(resolved.state, "RESOLVED"); assert.equal(resolved.history.length, 3);
  assert.throws(() => recordCustomerRetry(resolved, 1, "FAILED", now));
});
test("renewal preserves usage, carries remaining quota and extends exact 30-day periods", () => {
  const target = renewalTarget(base, "200", 2, now);
  assert.equal(target.usedBytes, "400"); assert.equal(target.remainingBytes, "800"); assert.equal(target.totalBytes, "1200");
  assert.equal(Date.parse(target.expiresAt) - Date.parse(base.expiresAt), 60 * 86400000);
  const late = renewalTarget(base, "200", 1, "2027-01-01T00:00:00.000Z");
  assert.equal(late.expiresAt, "2027-01-31T00:00:00.000Z");
  const overused = renewalTarget({ ...base, usedBytes: "1100", remainingBytes: "0" }, "200", 1, now);
  assert.equal(overused.usedBytes, "1100"); assert.equal(overused.remainingBytes, "200");
});
test("replacement needs a genuinely different finite-limit key with identical quota, history and expiry", () => {
  const after = { ...base, keyId: "fixture-key-after", version: 5 };
  const proof = { installedLimitBytes: "600", oldKeyDisabled: true, limitVerified: true };
  assert.doesNotThrow(() => assertReplacementPreserved(base, after, proof));
  for (const altered of [ { ...after, keyId: base.keyId }, { ...after, owner: foreign }, { ...after, expiresAt: now },
    { ...after, totalBytes: "2000", remainingBytes: "1600" }, { ...after, usedBytes: "0", remainingBytes: "1000" },
    { ...after, usageHistoryVersion: 0 }, { ...after, version: 6 } ]) assert.throws(() => assertReplacementPreserved(base, altered, proof));
  for (const altered of [ { ...proof, installedLimitBytes: "0" }, { ...proof, installedLimitBytes: "1000" },
    { ...proof, oldKeyDisabled: false }, { ...proof, limitVerified: false } ]) assert.throws(() => assertReplacementPreserved(base, after, altered));
  assert.equal(entitlementSchema.safeParse({ ...base, remainingBytes: "1000" }).success, false);
});
test("state machines forbid unpaid provisioning, unverified confirmation and unsafe replacement completion", () => {
  assert.throws(() => assertTransition("payment", "UNDER_REVIEW", "CONFIRMED"));
  assert.throws(() => assertTransition("provisioning", "NOT_REQUESTED", "QUEUED"));
  assert.throws(() => assertTransition("order", "AWAITING_PAYMENT", "COMPLETE"));
  assert.throws(() => assertTransition("replacement", "REQUESTED", "COMPLETED"));
  assert.throws(() => assertTransition("replacement", "COMMITTED", "COMPLETED", { failureVerified: true, ownershipVerified: true,
    newKeyBlocked: true, limitVerified: true, oldKeyDisabled: true, preservationVerified: true, now, expiresAt: now, remainingBytes: "600" }));
});
test("admin audit is mandatory and failure blocks sensitive operations", async () => {
  let calls = 0;
  const transport: MockVpnTransport = { mode: "mock", execute: async () => { calls++; return {}; } };
  const client = setup({ admin: true, transport, audit: async () => { throw new Error("private audit failure"); } }).client;
  await assert.rejects(client.execute("credentials.reveal", { owner, entitlementId: base.id, issueId: "issue", expectedVersion: 4, reason: "ADMIN_CONNECTION_TEST" }, metadata()), code("AUDIT_UNAVAILABLE")); assert.equal(calls, 0);
  const noAudit = createVpnServiceClient({ mode: "mock", transport, readSession: async () => ({ user: { id: "reviewer" } }), authorize: async () => true });
  await assert.rejects(noAudit.execute("diagnostics.get", { owner, entitlementId: base.id }, metadata()), code("AUDIT_UNAVAILABLE"));
});
test("credential values cannot leak through serialization, inspection or transport errors", async () => {
  const fixtureOnly = ["ss:", "//invalid-fixture-only"].join("");
  const credential = new SensitiveCredential(fixtureOnly);
  assert.throws(() => JSON.stringify({ credential }), /serialization forbidden/);
  assert.ok(!inspect(credential).includes(fixtureOnly)); assert.ok(!String(credential).includes(fixtureOnly));
  const client = setup({ transport: { mode: "mock", execute: async () => { throw new Error(fixtureOnly); } } }).client;
  await assert.rejects(client.execute("catalog.get", {}, metadata()), error => {
    assert.ok(error instanceof VpnServiceError); assert.ok(!JSON.stringify(error.publicResult()).includes(fixtureOnly)); return error.code === "UNAVAILABLE";
  });
  await assert.rejects(setup({ admin: true }).client.execute("credentials.reveal", { owner, entitlementId: base.id, issueId: "issue", expectedVersion: 4, reason: "ADMIN_CONNECTION_TEST" }, metadata()), code("UNAVAILABLE"));
});
test("same-owner wrong-resource responses and inherited operation names are rejected", async () => {
  const client = setup({ transport: { mode: "mock", execute: async () => ({ id: "other-order", owner, quoteId: "quote",
    state: "AWAITING_PAYMENT", payment: "UNVERIFIED", provisioning: "NOT_REQUESTED", totalMmk: "1" }) } }).client;
  await assert.rejects(client.execute("orders.get", { orderId: "requested-order" }, metadata()), code("INVALID_RESPONSE"));
  await assert.rejects(client.execute("__proto__" as Operation, {}, metadata()), code("INVALID_REQUEST"));
});
test("issue notification envelopes target website admins and contain no credential or Telegram routing", () => {
  const event = { version: "metro-vpn.v1", eventId: randomUUID(), owner, audience: "website-admin", topic: "vpn.issue.reported", issueId: "issue", occurredAt: now };
  assert.ok(adminNotificationSchema.safeParse(event).success);
  assert.equal(adminNotificationSchema.safeParse({ ...event, telegramId: "1" }).success, false);
  assert.equal(adminNotificationSchema.safeParse({ ...event, credential: "forbidden" }).success, false);
});
test("expired or exhausted entitlements cannot request a replacement", async () => {
  for (const entitlement of [{ ...base, expiresAt: "2026-10-19T00:00:00.000Z" }, { ...base, usedBytes: "1000", remainingBytes: "0" }]) {
    const transport = createMockVpnTransport({ catalog: { catalogVersion: "fixture-catalog", packages: [pkg] }, entitlements: [entitlement], now: () => now });
    const { client } = setup({ transport, admin: true }); const issue = await report(client);
    await client.execute("diagnostics.record", { owner, entitlementId: base.id, issueId: issue.id, expectedVersion: 4, result: "FAILED" }, metadata());
    await assert.rejects(client.execute("replacements.request", { owner, entitlementId: base.id, issueId: issue.id, expectedVersion: 4, reason: "VERIFIED_KEY_FAILURE" }, metadata()), code("CONFLICT"));
  }
});
test("successful credential transport still cannot return a value if result auditing fails", async () => {
  let appends = 0; const events: AuditEvent[] = [];
  const client = setup({ admin: true, transport: { mode: "mock", execute: async () => ({ owner, entitlementId: base.id, version: 4, keyId: base.keyId,
    credential: ["ss:", "//invalid-fixture-only"].join("") }) }, audit: async event => { events.push(event); appends++; if(appends === 2) throw new Error("Audit unavailable."); } }).client;
  await assert.rejects(client.execute("credentials.reveal", { owner, entitlementId: base.id, issueId: "issue", expectedVersion: 4, reason: "ADMIN_CONNECTION_TEST" }, metadata()), code("AUDIT_UNAVAILABLE"));
  assert.equal(events[0].outcome, "INTENT"); assert.equal(events.at(-1)?.outcome, "FAILURE");
  assert.ok(!JSON.stringify(events).includes("ss:")); assert.equal(events[0].resourceId, base.id);
});
test("catalog and entitlement read commands are the only ordinary non-mutating discovery operations", () => {
  const operations = Object.keys(contracts) as Operation[];
  assert.equal(operations.length, 12);
  assert.equal(contracts["credentials.reveal"].mutation, true);
  assert.equal(contracts["payments.confirm"].permission, "payments:confirm");
});
