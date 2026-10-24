import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import { SignJWT } from "jose";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getPrisma } from "../src/server/db/client.ts";
import { createAuthOptions } from "../src/server/auth/options.ts";
import { parseServerEnvironment } from "../src/server/env.ts";
import { readSmtpEnvironment, verificationMessage, createVerificationTransport } from "../src/server/email/verification.ts";
import { publicAuthPayload } from "../src/server/auth/public-response.ts";
import { prepareAuthRequest } from "../src/server/auth/request-policy.ts";
import { isSafeAuthCallback } from "../src/features/auth/redirects.ts";
import { submitAuth } from "../src/features/auth/client.ts";

// No SMTP, Neon or other network use in this isolated suite. Real delivery is
// a separate, explicitly authorized single request after verification passes.
let networkAttempts = 0;
const guard = mock.method(net.Socket.prototype, "connect", () => { networkAttempts++; throw new Error("Isolated network guard"); });
after(() => { guard.mock.restore(); assert.equal(networkAttempts, 0); });
const origin = "http://127.0.0.1:3000";
const secret = randomBytes(48).toString("base64url");
const env = parseServerEnvironment({ METRO_AUTH_ENABLED: "true", NODE_ENV: "test", BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: secret, METRO_DATABASE_URL: "postgresql://isolated:unused@127.0.0.1:1/metro_isolated" });
assert.ok(env.enabled);
const deliveries: Array<{ email: string; url: string; origin: string }> = [];
const options = createAuthOptions(env, getPrisma(env), async input => { deliveries.push(input); });

test("SMTP uses existing variable names, fixed sender and strict implicit TLS without logging", () => {
  const raw = randomBytes(16).toString("hex").replace(/[0-9]/g, "a").slice(0, 16);
  assert.equal(readSmtpEnvironment({ SMTP_USER: "metro.service.net@gmail.com", SMTP_APP_PASSWORD: raw.match(/.{4}/g)!.join(" ") }).password, raw);
  for (const source of [{}, { SMTP_USER: "other@example.invalid", SMTP_APP_PASSWORD: raw }, { SMTP_USER: "metro.service.net@gmail.com", SMTP_APP_PASSWORD: "weak" }]) {
    assert.throws(() => readSmtpEnvironment(source), /configuration is unavailable/);
  }
  const previous = { user: process.env.SMTP_USER, password: process.env.SMTP_APP_PASSWORD };
  process.env.SMTP_USER = "metro.service.net@gmail.com"; process.env.SMTP_APP_PASSWORD = raw;
  try {
    const transport = createVerificationTransport();
    const config = transport.options as { host: string; port: number; secure: boolean; logger: boolean; debug: boolean; tls: { rejectUnauthorized: boolean; servername: string } };
    assert.equal(config.host, "smtp.gmail.com"); assert.equal(config.port, 465); assert.equal(config.secure, true);
    assert.equal(config.tls.rejectUnauthorized, true); assert.equal(config.tls.servername, config.host);
    assert.equal(config.logger, false); assert.equal(config.debug, false); transport.close();
  } finally {
    if (previous.user === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = previous.user;
    if (previous.password === undefined) delete process.env.SMTP_APP_PASSWORD; else process.env.SMTP_APP_PASSWORD = previous.password;
  }
});

test("branded HTML and plain text use only the pinned verification fragment", () => {
  const message = verificationMessage(origin, `${origin}/api/auth/verify-email?token=aaa.bbb.ccc&callbackURL=%2Fverify-email`);
  assert.match(message.html, /METRO/); assert.match(message.text, /60 minutes/);
  assert.ok(message.html.includes(`${origin}/verify-email#token=aaa.bbb.ccc`));
  assert.ok(!message.html.includes("?token="));
  for (const url of ["https://evil.invalid/api/auth/verify-email?token=a.b.c", `${origin}/elsewhere?token=a.b.c`, `${origin}/api/auth/verify-email?token=a.b.c&token=x.y.z`, `${origin}/api/auth/verify-email?token=%3Cscript%3E`]) {
    assert.throws(() => verificationMessage(origin, url));
  }
  assert.equal(isSafeAuthCallback("/verify-email", origin), true);
  assert.equal(isSafeAuthCallback("/verify-email?next=https://evil.invalid", origin), false);
});

test("verification policy requires explicit resend, signed one-hour tokens, no automatic session and database rate limits", () => {
  assert.equal(options.emailAndPassword.requireEmailVerification, true);
  assert.equal(options.emailVerification.sendOnSignUp, true);
  assert.equal(options.emailVerification.sendOnSignIn, false);
  assert.equal(options.emailVerification.autoSignInAfterVerification, false);
  assert.equal(options.emailVerification.expiresIn, 3600);
  assert.equal(options.rateLimit.storage, "database");
  assert.equal(options.rateLimit.customRules["/send-verification-email"].max, 1);
  assert.equal(options.rateLimit.customRules["/verify-email"].max, 10);
});

test("actual Better Auth lifecycle: signup delivery, verification gate, expiry, resend, verified login, persistence and logout", async () => {
  const db: Record<string, Array<Record<string, unknown>>> = { user: [], account: [], session: [], verification: [], rateLimit: [] };
  const auth = betterAuth({ ...options, database: memoryAdapter(db), rateLimit: { ...options.rateLimit, enabled: false } });
  const email = `${randomUUID()}@example.invalid`, password = randomBytes(24).toString("base64url");
  async function request(path: string, body?: Record<string, unknown>, cookie?: string) {
    return auth.handler(new Request(`${origin}/api/auth/${path}`, { method: body ? "POST" : "GET",
      headers: { origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }));
  }
  const initial = deliveries.length;
  const signup = await request("sign-up/email", { name: "Isolated fixture", email, password, callbackURL: "/verify-email" });
  assert.equal(signup.status, 200); assert.equal(deliveries.length, initial + 1);
  assert.equal(db.user.length, 1); assert.equal(db.session.length, 0); assert.equal(db.user[0].emailVerified, false);
  const id = db.user[0].id, accountId = db.account[0].id;
  const rejected = await request("sign-in/email", { email, password });
  assert.equal(rejected.status, 403); assert.equal((await rejected.json()).code, "EMAIL_NOT_VERIFIED");
  assert.equal(deliveries.length, initial + 1, "sign-in must not send another email");
  const expired = await new SignJWT({ email }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(new TextEncoder().encode(secret));
  const expiredResult = await request(`verify-email?token=${encodeURIComponent(expired)}`);
  assert.equal(expiredResult.status, 401);
  const expiredBody = await expiredResult.json();
  assert.equal((publicAuthPayload("/verify-email", 401, expiredBody) as { error: { code: string } }).error.code, "VERIFICATION_EXPIRED");
  assert.equal(db.user[0].emailVerified, false);
  const resend = await request("send-verification-email", { email, callbackURL: "/verify-email" });
  assert.equal(resend.status, 200); assert.equal(deliveries.length, initial + 2);
  const token = new URL(deliveries.at(-1)!.url).searchParams.get("token")!;
  const verified = await request(`verify-email?token=${encodeURIComponent(token)}`);
  assert.equal(verified.status, 200); assert.equal(db.user[0].emailVerified, true);
  assert.equal(db.user[0].id, id); assert.equal(db.account[0].id, accountId); assert.equal(db.session.length, 0);
  const verifiedSnapshot = JSON.stringify(db);
  const replay = await request(`verify-email?token=${encodeURIComponent(token)}`);
  assert.equal(replay.status, 200, "Better Auth intentionally returns idempotent success");
  assert.equal(JSON.stringify(db), verifiedSnapshot, "Replay must not change verified identity or issue a session");
  assert.equal(replay.headers.get("set-cookie"), null);
  const wrong = await request("sign-in/email", { email, password: randomBytes(24).toString("base64url") });
  assert.equal(wrong.status, 401);
  const login = await request("sign-in/email", { email, password }); assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookie.includes("metro.session_token="));
  assert.ok(login.headers.getSetCookie().some(value => /HttpOnly/i.test(value)));
  for (let i = 0; i < 2; i++) {
    const session = await request("get-session", undefined, cookie);
    assert.equal(session.status, 200); assert.equal((await session.json()).user.id, id);
  }
  const duplicate = await request("sign-up/email", { email, password, name: "Duplicate" });
  assert.equal(duplicate.status, 200); assert.equal(db.user.length, 1); assert.equal(deliveries.length, initial + 2);
  const logout = await request("sign-out", {}, cookie); assert.equal(logout.status, 200);
  assert.equal(await (await request("get-session", undefined, cookie)).json(), null);
});

test("official resend handler uses database-backed throttling without disclosing unknown accounts", async () => {
  const db: Record<string, Array<Record<string, unknown>>> = { user: [], account: [], session: [], verification: [], rateLimit: [] };
  const auth = betterAuth({ ...options, database: memoryAdapter(db) });
  const body = JSON.stringify({ email: `${randomUUID()}@example.invalid`, callbackURL: "/verify-email" });
  const make = () => auth.handler(new Request(`${origin}/api/auth/send-verification-email`, { method: "POST",
    headers: { origin, "content-type": "application/json", "x-metro-auth-ip": "127.0.0.1" }, body }));
  const initial = deliveries.length;
  assert.equal((await make()).status, 200);
  assert.equal((await make()).status, 429);
  assert.equal(deliveries.length, initial); assert.ok(db.rateLimit.length > 0);
});

test("verification POST rejects cross-origin/missing-origin requests and unsafe callbacks", async () => {
  for (const headers of [{}, { origin: "https://evil.invalid" }, { origin, "sec-fetch-site": "cross-site" }]) {
    const request = new Request(`${origin}/api/auth/verify-email`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ token: "a.b.c" }) });
    await assert.rejects(() => prepareAuthRequest(request, env), { status: 403 });
  }
  await assert.rejects(() => prepareAuthRequest(new Request(`${origin}/api/auth/send-verification-email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "fixture@example.invalid", callbackURL: "https://evil.invalid" }) }), env), { code: "INVALID_CALLBACK" });
});

test("public verification errors are useful and redact private payloads", async () => {
  const privateValue = randomBytes(24).toString("hex");
  for (const code of ["INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"]) {
    const result = JSON.stringify(publicAuthPayload("/verify-email", 401, { code, message: privateValue }));
    assert.ok(!result.includes(privateValue)); assert.match(result, /INVALID_VERIFICATION_LINK/);
  }
  const replacement = mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "EMAIL_NOT_VERIFIED" } }, { status: 403 }));
  try { assert.match((await submitAuth("sign-in/email", {}))!, /Verify your email/); }
  finally { replacement.mock.restore(); }
});
