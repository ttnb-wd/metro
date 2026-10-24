import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prepareAuthRequest } from "../src/server/auth/request-policy.ts";
import { INTERNAL_AUTH_IP_HEADER } from "../src/server/auth/options.ts";

const origin = "https://metro.example.invalid", proxySecret = randomBytes(48).toString("hex");
const env = { enabled: true as const, nodeEnv: "production" as const, origin, databaseUrl: "postgresql://isolated:unused@127.0.0.1:1/isolated", secret: randomBytes(48).toString("base64url"), proxySecret };
const request = (extra: Record<string, string> = {}) => new Request("http://web:3000/api/auth/sign-in/email", { method: "POST", headers: { host: "metro.example.invalid", origin, "content-type": "application/json", "x-forwarded-proto": "https", "x-real-ip": "203.0.113.7", "x-metro-proxy-token": proxySecret, ...extra }, body: JSON.stringify({ email: "fixture@example.invalid", password: "fixture-password" }) });

test("private proxy ingress normalizes only verified canonical HTTPS and strips its secret", async () => {
  const prepared = await prepareAuthRequest(request(), env);
  assert.equal(new URL(prepared.url).origin, origin);
  assert.equal(prepared.headers.get("x-metro-proxy-token"), null);
  assert.equal(prepared.headers.get("x-real-ip"), null);
  assert.ok(prepared.headers.get(INTERNAL_AUTH_IP_HEADER));
});

test("spoofed, duplicated or missing proxy credentials and noncanonical hosts fail closed", async () => {
  for (const headers of [{ "x-metro-proxy-token": "" }, { "x-metro-proxy-token": randomBytes(48).toString("hex") }, { "x-metro-proxy-token": proxySecret + "," + proxySecret }, { host: "attacker.invalid" }, { "x-forwarded-proto": "http" }, { "x-real-ip": "203.0.113.7,198.51.100.1" }, { origin: "https://attacker.invalid" }]) await assert.rejects(prepareAuthRequest(request(headers), env));
  await assert.rejects(prepareAuthRequest(request(), { ...env, proxySecret: undefined }));
});

test("Vercel cannot be selected by a request header and ignores self-hosted token authentication", async () => {
  const r = request({ "x-metro-proxy-token": "invalid", "x-vercel-id": "spoofed" });
  await assert.rejects(prepareAuthRequest(r, env));
  const vercel = new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": "203.0.113.8", "x-metro-proxy-token": "not-used" }, body: JSON.stringify({ email: "fixture@example.invalid", password: "fixture-password" }) });
  assert.ok((await prepareAuthRequest(vercel, { ...env, platform: "vercel" })).headers.get(INTERNAL_AUTH_IP_HEADER));
});
