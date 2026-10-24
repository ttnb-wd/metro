import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { prepareAuthRequest } from "../src/server/auth/request-policy.ts";
import { INTERNAL_AUTH_IP_HEADER } from "../src/server/auth/options.ts";
import { validateFulfilmentResult } from "../src/server/commerce/fulfilment-result.ts";
import { contentSecurityPolicy, browserProtectionHeaders } from "../src/security-headers.ts";
import { fulfilmentEnabled } from "../src/server/commerce/config.ts";

const now = Date.now(), userId = randomUUID(), packageId = randomUUID();
const operation = { id: randomUUID(), userId, kind: "PROVISION", orderId: randomUUID(), expectedVersion: null, createdAt: new Date(now - 1000), frozenSnapshot: { id: randomUUID(), packageId, pricingVersion: 3, months: 1, durationDays: 30, quotaBytes: "10737418240" } };
const entitlement = { id: randomUUID(), owner: { issuer: "metro-website", subject: userId }, packageId, version: 0, status: "ACTIVE", keyId: "mw-fixture", keyStatus: "ENFORCED", expiresAt: new Date(now + 30 * 86400000).toISOString(), totalBytes: "10737418240", usedBytes: "0", remainingBytes: "10737418240", usageHistoryVersion: 0, observedAt: new Date(now).toISOString() };
const receipt = { protocol: "metro-fulfilment-receipt.v1", operationId: operation.id, kind: "PROVISION", orderId: operation.orderId, quoteId: operation.frozenSnapshot.id, quoteVersion: 3, appliedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString(), purchase: { packageId, quotaBytes: operation.frozenSnapshot.quotaBytes, months: 1, durationDays: 30 }, enforcement: { counterBytes: "0", windowBytes: "0", counterEpoch: "fixture", verifiedAt: new Date(now).toISOString() }, before: null, entitlement, usageOffsetBytes: "0", previousUsageOffsetBytes: "0", verifiedFiniteLimitBytes: entitlement.totalBytes, oldKeyId: null, oldKeyRevoked: false };
test("exact first-purchase result requires a complete correlated backend receipt", () => {
  assert.deepEqual(validateFulfilmentResult(receipt, operation, now), entitlement);
  assert.throws(() => validateFulfilmentResult(entitlement, operation, now));
});
for (const [name, change] of Object.entries({
  "wrong operation": (r: typeof receipt) => { r.operationId = randomUUID(); },
  "wrong customer": (r: typeof receipt) => { r.entitlement.owner.subject = randomUUID(); },
  "wrong package": (r: typeof receipt) => { r.entitlement.packageId = randomUUID(); },
  "wrong pricing version": (r: typeof receipt) => { r.quoteVersion++; },
  "wrong quote": (r: typeof receipt) => { r.quoteId = randomUUID(); },
  "excess quota": (r: typeof receipt) => { r.entitlement.totalBytes = "21474836480"; r.entitlement.remainingBytes = r.entitlement.totalBytes; r.verifiedFiniteLimitBytes = r.entitlement.totalBytes; },
  "one-day expiry": (r: typeof receipt) => { r.entitlement.expiresAt = new Date(now + 86400000).toISOString(); },
  "extended expiry": (r: typeof receipt) => { r.entitlement.expiresAt = new Date(now + 31 * 86400000).toISOString(); },
  "unavailable observation": (r: typeof receipt) => { r.entitlement.observedAt = null; },
  "zero finite limit": (r: typeof receipt) => { r.verifiedFiniteLimitBytes = "0"; },
  "wrong version": (r: typeof receipt) => { r.entitlement.version = 8; },
})) test(`fulfilment rejects ${name}`, () => { const r = structuredClone(receipt); change(r); assert.throws(() => validateFulfilmentResult(r, operation, now)); });

test("renewal carries quota and usage forward, extends from later expiry, and retains key", () => {
  const before = { ...entitlement, version: 4, totalBytes: "1000", usedBytes: "400", remainingBytes: "600", expiresAt: new Date(now + 5 * 86400000).toISOString(), usageHistoryVersion: 6 };
  const r = { ...receipt, before, entitlement: { ...entitlement, version: 5, totalBytes: "10737419240", usedBytes: "450", remainingBytes: "10737418790", expiresAt: new Date(now + 35 * 86400000).toISOString(), usageHistoryVersion: 6 }, enforcement: { ...receipt.enforcement, counterBytes: "450", windowBytes: "450" }, verifiedFiniteLimitBytes: "10737419240" };
  assert.equal(validateFulfilmentResult(r, operation, now).keyId, before.keyId);
  assert.equal(validateFulfilmentResult(r, operation, now, before).totalBytes, r.entitlement.totalBytes);
  assert.throws(() => validateFulfilmentResult(r, operation, now, { ...before, totalBytes: "2000", remainingBytes: "1600" }));
  assert.throws(() => validateFulfilmentResult(r, operation, now, { ...before, keyId: "different-existing-key" }));
  assert.throws(() => validateFulfilmentResult({ ...r, before: { ...before, observedAt: null } }, operation, now));
  assert.throws(() => validateFulfilmentResult({ ...r, before: { ...before, observedAt: new Date(now - 300001).toISOString() } }, operation, now));
  for (const patch of [{ keyId: "other-key" }, { usedBytes: "399", remainingBytes: "10737418841" }, { usageHistoryVersion: 5 }]) assert.throws(() => validateFulfilmentResult({ ...r, entitlement: { ...r.entitlement, ...patch } }, operation, now));
});
test("replacement requires old-key revocation and preserves exact quota, expiry and cumulative use", () => {
  const before = { ...entitlement, version: 4, usedBytes: "400", remainingBytes: "10737417840", usageHistoryVersion: 5 };
  const op = { ...operation, kind: "REPLACEMENT", orderId: null, expectedVersion: 4, frozenSnapshot: before };
  const r = { ...receipt, kind: "REPLACEMENT", orderId: null, quoteId: null, quoteVersion: null, purchase: null, before, entitlement: { ...before, version: 5, keyId: "new-finite-key" }, usageOffsetBytes: "400", verifiedFiniteLimitBytes: before.remainingBytes, oldKeyId: before.keyId, oldKeyRevoked: true };
  assert.equal(validateFulfilmentResult(r, op, now).usedBytes, "400");
  assert.throws(() => validateFulfilmentResult({ ...r, oldKeyRevoked: false }, op, now));
  assert.throws(() => validateFulfilmentResult({ ...r, oldKeyId: "wrong-key" }, op, now));
  assert.throws(() => validateFulfilmentResult({ ...r, entitlement: { ...r.entitlement, expiresAt: new Date(now + 31 * 86400000).toISOString() } }, op, now));
});
test("stale operation observations are rejected and production execution requires reviewed receipt support", () => {
  assert.throws(() => validateFulfilmentResult(receipt, operation, now + 300001));
  assert.equal(fulfilmentEnabled({ METRO_FULFILMENT_ENABLED: "true", METRO_VPN_EXECUTION_APPROVED: "true" }), false);
});
test("Vercel ingress identification is explicit and missing/untrusted production identity fails closed", async () => {
  const env = { enabled: true as const, nodeEnv: "production" as const, origin: "https://metro.example.invalid", databaseUrl: "unused", secret: randomBytes(32).toString("hex") };
  const request = (extra: Record<string, string> = {}) => new Request(env.origin + "/api/auth/sign-in/email", { method: "POST", headers: { origin: env.origin, "content-type": "application/json", ...extra }, body: JSON.stringify({ email: "fixture@example.invalid", password: "not-logged" }) });
  await assert.rejects(prepareAuthRequest(request({ "x-real-ip": "203.0.113.1" }), env), { status: 503 });
  await assert.rejects(prepareAuthRequest(request({ "x-forwarded-for": "203.0.113.1" }), { ...env, platform: "vercel" }), { status: 503 });
  const one = await prepareAuthRequest(request({ "x-real-ip": "203.0.113.1", "x-metro-auth-source": "spoof" }), { ...env, platform: "vercel" });
  const two = await prepareAuthRequest(request({ "x-real-ip": "203.0.113.2", "x-metro-auth-ip": "spoof" }), { ...env, platform: "vercel" });
  assert.equal(one.headers.get(INTERNAL_AUTH_IP_HEADER), two.headers.get(INTERNAL_AUTH_IP_HEADER));
  assert.notEqual(one.headers.get("x-metro-auth-source"), "spoof");
});
test("production CSP uses per-request nonces and retains required image, style and printing behavior", () => {
  const policy = contentSecurityPolicy("fixture-nonce", false, true);
  assert.match(policy, /script-src 'self' 'nonce-fixture-nonce' 'strict-dynamic'/);
  assert.doesNotMatch(policy, /unsafe-eval/); assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /img-src 'self' blob: data:/); assert.match(policy, /upgrade-insecure-requests/);
  assert.equal(browserProtectionHeaders.find(h => h.key === "X-Frame-Options")?.value, "DENY");
});
