import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

// Install the guard before importing the auth/database modules. No test may
// open a TCP socket, query PostgreSQL, or use a real database or user account.
let networkAttempts = 0;
const socketGuard = mock.method(net.Socket.prototype, "connect", () => {
  networkAttempts++;
  throw new Error("Network connections are forbidden in isolated auth tests.");
});
after(() => { socketGuard.mock.restore(); assert.equal(networkAttempts, 0); });

const { parseServerEnvironment, EnvironmentConfigurationError } = await import("../src/server/env.ts");
const { getPrisma } = await import("../src/server/db/client.ts");
const { createPgPoolConfig, ChannelBindingClient } = await import("../src/server/db/connection-config.ts");
const { assertWebsiteDatabaseReady } = await import("../src/server/db/verify-target.ts");
const { createAuthOptions, INTERNAL_AUTH_IP_HEADER } = await import("../src/server/auth/options.ts");
const { getAuth, AuthUnavailableError } = await import("../src/server/auth/index.ts");
const { getWebsiteSession, requireWebsiteSession, websiteUserScope } = await import("../src/server/auth/session.ts");
const { safeReturnPath, isSafeAuthCallback } = await import("../src/server/auth/redirects.ts");
const { prepareAuthRequest, MAX_AUTH_BODY_BYTES } = await import("../src/server/auth/request-policy.ts");
const { handleAuthRequest } = await import("../src/server/auth/http.ts");
const { publicAuthPayload } = await import("../src/server/auth/public-response.ts");
const { canonicalAuthPageUrl } = await import("../src/server/auth/canonical-origin.ts");
const { submitAuth } = await import("../src/features/auth/client.ts");
const { GET, POST } = await import("../src/app/api/auth/[...all]/route.ts");
const { betterAuth } = await import("better-auth");
const { hashPassword, verifyPassword } = await import("better-auth/crypto");
const { getCookies } = await import("better-auth/cookies");
const { getAuthTables } = await import("@better-auth/core/db");

const testSecret = randomBytes(48).toString("base64url");
const fixture = {
  NODE_ENV: "test",
  METRO_AUTH_ENABLED: "true",
  METRO_DATABASE_URL: "postgresql://isolated:unused@127.0.0.1:1/metro_isolated",
  BETTER_AUTH_SECRET: testSecret,
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
};
const environment = parseServerEnvironment(fixture);
assert.ok(environment.enabled);
const prisma = getPrisma(environment);
const options = createAuthOptions(environment, prisma);
const origin = fixture.BETTER_AUTH_URL;

function withEnvironment(values: Record<string, string | undefined>, action: () => unknown) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return Promise.resolve().then(action).finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function post(body: string | object, additionalHeaders: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...additionalHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("auth is disabled by default, including when generic DATABASE_URL exists", () => {
  assert.equal(parseServerEnvironment({ DATABASE_URL: fixture.METRO_DATABASE_URL }).enabled, false);
  assert.equal(parseServerEnvironment({ METRO_AUTH_ENABLED: "false", BETTER_AUTH_SECRET: "unused" }).enabled, false);
  assert.throws(() => parseServerEnvironment({ METRO_AUTH_ENABLED: "yes" }), EnvironmentConfigurationError);
  assert.throws(() => parseServerEnvironment({ METRO_AUTH_ENABLED: "true", DATABASE_URL: fixture.METRO_DATABASE_URL }), EnvironmentConfigurationError);
});

test("enabled auth requires all dedicated settings and rejects weak/placeholder secrets", () => {
  for (const key of ["METRO_DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) {
    assert.throws(() => parseServerEnvironment({ ...fixture, [key]: undefined }), EnvironmentConfigurationError);
  }
  for (const secret of ["short", "x".repeat(64), "replace-me-with-your-auth-secret-value"]) {
    assert.throws(() => parseServerEnvironment({ ...fixture, BETTER_AUTH_SECRET: secret }), EnvironmentConfigurationError);
  }
});

test("environment errors redact URL credentials, invalid input, and secret values", () => {
  for (const url of ["not-a-url", "postgresql://private-user:private-value@remote.invalid/db?sslmode=disable"]) {
    try {
      parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: url });
      assert.fail("Invalid configuration must fail.");
    } catch (error) {
      assert.ok(error instanceof EnvironmentConfigurationError);
      assert.ok(!String(error).includes(url));
      assert.ok(!String(error).includes("private-value"));
      assert.ok(!String(error).includes(testSecret));
    }
  }
});

test("database configuration requires PostgreSQL, credentials, a dedicated DB, and strict remote TLS", () => {
  for (const url of [
    "mysql://user:password@127.0.0.1/db",
    "postgresql://127.0.0.1/metro",
    "postgresql://user:password@127.0.0.1/postgres",
    "postgresql://user:password@remote.invalid/metro",
    "postgresql://user:password@remote.invalid/metro?sslmode=require",
    "postgresql://user:password@remote.invalid/metro?sslmode=no-verify",
    "postgresql://user:password@remote.invalid/metro?sslmode=verify-full&sslrootcert=system",
  ]) assert.throws(() => parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: url }), EnvironmentConfigurationError);
  assert.ok(parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: "postgresql://isolated:unused@remote.invalid/metro?sslmode=verify-full" }).enabled);
});

test("Neon channel binding allowlist is narrow and cannot weaken TLS", () => {
  const base = "postgresql://isolated:unused@ep-fixture-pooler.region.aws.neon.tech/metro?sslmode=verify-full";
  for (const mode of ["prefer", "require"]) {
    const accepted = parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: `${base}&channel_binding=${mode}`, METRO_DIRECT_DATABASE_URL: `${base.replace('-pooler.', '.')}&channel_binding=${mode}` });
    assert.ok(accepted.enabled);
    assert.ok(accepted.directDatabaseUrl);
  }
  for (const suffix of ["&channel_binding=disable", "&channel_binding=anything", "&channel_binding=", "&channel_binding=require&channel_binding=prefer", "&uselibpqcompat=true", "&sslmode=disable"]) {
    assert.throws(() => parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: base + suffix }), EnvironmentConfigurationError);
  }
  assert.throws(() => parseServerEnvironment({ ...fixture, METRO_DIRECT_DATABASE_URL: base.replace('verify-full', 'require') }), EnvironmentConfigurationError);
  assert.throws(() => parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: 'postgrpostgresql://isolated:unused@remote.invalid/metro?sslmode=verify-full' }), EnvironmentConfigurationError);
  assert.throws(() => parseServerEnvironment({ ...fixture, METRO_DATABASE_URL: fixture.METRO_DATABASE_URL + '?sslmode=disable&channel_binding=require' }), EnvironmentConfigurationError);
});

test("authentication target guard rejects Aiven and unapproved Neon identities before connecting", async () => {
  for (const url of [
    'postgresql://isolated:unused@vpn.aivencloud.com/metro?sslmode=verify-full',
    'postgresql://isolated:unused@ep-other-pooler.region.aws.neon.tech/neondb?sslmode=verify-full',
    'postgresql://isolated:unused@ep-floral-lab-azihv1v9-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',
  ]) await assert.rejects(() => assertWebsiteDatabaseReady({ ...environment, databaseUrl: url }), /target is not approved/);
  assert.equal(networkAttempts, 0);
});

test("PostgreSQL config explicitly verifies TLS and enforces required native channel binding", () => {
  const config = createPgPoolConfig("postgresql://isolated:unused@ep-fixture-pooler.region.aws.neon.tech/metro?sslmode=verify-full&channel_binding=require");
  assert.equal(config.connectionString, undefined);
  assert.equal(config.host, "ep-fixture-pooler.region.aws.neon.tech");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, servername: config.host });
  assert.equal(config.enableChannelBinding, true);
  const client = new ChannelBindingClient(config);
  assert.throws(() => config.onConnect(client), /required channel binding was not negotiated/);
  client.saslSession = { mechanism: "SCRAM-SHA-256-PLUS" };
  client.connection.emit("authenticationSASLContinue");
  assert.equal(client.channelBindingNegotiated, true);
  assert.doesNotThrow(() => config.onConnect(client));
  const fallback = new ChannelBindingClient(config);
  fallback.saslSession = { mechanism: "SCRAM-SHA-256" };
  fallback.connection.emit("authenticationSASLContinue");
  assert.throws(() => config.onConnect(fallback), /required channel binding was not negotiated/);
  assert.equal(createPgPoolConfig(fixture.METRO_DATABASE_URL).ssl, false);
});

test("origin is explicit, never contains credentials/path, and requires HTTPS outside loopback development", () => {
  for (const url of ["not-a-url", "https://metro.invalid/path", "https://user:pass@metro.invalid", "https://metro.invalid?next=evil", "http://metro.invalid"]) {
    assert.throws(() => parseServerEnvironment({ ...fixture, BETTER_AUTH_URL: url }), EnvironmentConfigurationError);
  }
  assert.throws(() => parseServerEnvironment({ ...fixture, NODE_ENV: "production" }), EnvironmentConfigurationError);
  assert.ok(parseServerEnvironment({ ...fixture, NODE_ENV: "production", BETTER_AUTH_URL: "https://metro.invalid" }).enabled);
});

test("Prisma construction and installed Better Auth schema validation do not connect to PostgreSQL", async () => {
  assert.equal(getPrisma(environment), prisma);
  assert.ok(prisma._runtimeDataModel?.models, "Generated Prisma metadata must be present");
  const { schemaCheckFor } = await import("@better-auth/core/db/internal");
  const adapter = options.database(options);
  assert.equal(typeof schemaCheckFor(adapter), "function", "Adapter must register its local schema check");
  await schemaCheckFor(adapter)?.();
  const auth = betterAuth(options);
  const context = await auth.$context;
  assert.equal(typeof context.explicitSchemaCheck, "function");
  await context.explicitSchemaCheck?.();
  assert.equal(networkAttempts, 0);
});

test("schema matches every installed adapter table and field, with website user ownership relations", async () => {
  const expected = getAuthTables(options);
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.deepEqual(Object.keys(expected).sort(), ["account", "rateLimit", "session", "user", "verification"]);
  for (const [key, table] of Object.entries(expected)) {
    const name = key[0].toUpperCase() + key.slice(1);
    const model = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(model, `${name} model is required`);
    for (const field of Object.keys(table.fields)) assert.match(model, new RegExp(`\\b${field}\\s+`));
  }
  assert.match(schema, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(schema, /lastRequest\s+BigInt/);
  assert.doesNotMatch(schema, /telegramId|chatId|outlineKey/i);
});

test("passwords use Better Auth scrypt with independent salts and correct verification", async () => {
  const password = randomBytes(24).toString("base64url");
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, password);
  assert.notEqual(first, second);
  assert.ok(await verifyPassword({ password, hash: first }));
  assert.equal(await verifyPassword({ password: password + "x", hash: first }), false);
  assert.equal(options.emailAndPassword.minPasswordLength, 12);
  assert.equal(options.emailAndPassword.maxPasswordLength, 128);
  assert.equal(options.emailAndPassword.disableSignUp, false);
});

test("session cookies are host-only, HttpOnly and SameSite Lax, with Secure on HTTPS", () => {
  const https = parseServerEnvironment({ ...fixture, NODE_ENV: "production", BETTER_AUTH_URL: "https://metro.invalid" });
  assert.ok(https.enabled);
  const cookie = getCookies(createAuthOptions(https, prisma)).sessionToken;
  assert.equal(cookie.attributes.httpOnly, true);
  assert.equal(cookie.attributes.secure, true);
  assert.equal(cookie.attributes.sameSite, "lax");
  assert.equal(cookie.attributes.path, "/");
  assert.equal(cookie.attributes.domain, undefined);
  assert.ok(cookie.name.includes("metro"));
  assert.equal(options.session.cookieCache.enabled, false);
  assert.equal(options.advanced.disableCSRFCheck, false);
  assert.equal(options.advanced.disableOriginCheck, false);
  assert.deepEqual(options.trustedOrigins, [origin]);
});

test("rate limiting uses database storage and stricter credential rules", () => {
  assert.equal(options.rateLimit.enabled, true);
  assert.equal(options.rateLimit.storage, "database");
  assert.equal(options.rateLimit.customRules["/sign-in/email"].max, 5);
  assert.equal(options.rateLimit.customRules["/sign-up/email"].max, 3);
  assert.equal(options.account.accountLinking.enabled, false);
});

test("return paths and callbacks reject open redirects and ambiguous URLs", () => {
  for (const value of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%2f%2fevil.invalid", "/dashboard?next=https://evil.invalid", "javascript:alert(1)", "/api/auth/sign-in/email", "/dashboard/../checkout", "\r\n/dashboard"]) {
    assert.equal(safeReturnPath(value), "/dashboard");
    assert.equal(isSafeAuthCallback(value, origin), false);
  }
  assert.equal(safeReturnPath("/dashboard/orders"), "/dashboard/orders");
  assert.equal(isSafeAuthCallback("/dashboard/orders", origin), true);
  assert.equal(isSafeAuthCallback(`${origin}/dashboard`, origin), true);
  assert.equal(isSafeAuthCallback("http://user:pass@127.0.0.1:3000/dashboard", origin), false);
});

test("HTTP auth responses never expose tokens, hashes, or synthetic user records", () => {
  const secret = randomBytes(24).toString("hex");
  const native = { token: secret, user: { id: 'website-user', name: 'Metro member', email: 'member@example.invalid', password: secret },
    session: { token: secret, id: secret, expiresAt: '2030-01-01' } };
  for (const path of ['/sign-in/email', '/sign-up/email', '/sign-out', '/get-session']) {
    const output = JSON.stringify(publicAuthPayload(path, 200, native));
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes('password'));
    assert.ok(!output.includes('token'));
  }
  assert.deepEqual(publicAuthPayload('/sign-up/email', 200, native), { success: true });
  assert.deepEqual(publicAuthPayload('/sign-up/email', 200, { token: null, user: { id: 'synthetic-user' } }), { success: true });
  assert.ok(!JSON.stringify(publicAuthPayload('/sign-in/email', 401, { message: secret })).includes(secret));
  assert.equal(safeReturnPath('/login'), '/dashboard');
  assert.equal(safeReturnPath('/register'), '/dashboard');
});

test("request policy rejects untrusted origins and non-JSON requests before auth initialization", async () => {
  await assert.rejects(() => prepareAuthRequest(post({}, { origin: "https://evil.invalid" }), environment), { status: 403 });
  await assert.rejects(() => prepareAuthRequest(post({}, { origin: "null" }), environment), { status: 403 });
  await assert.rejects(() => prepareAuthRequest(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", body: "{}" }), environment), { status: 403 });
  await assert.rejects(() => prepareAuthRequest(post({}, { "content-type": "application/x-www-form-urlencoded" }), environment), { status: 415 });
  await assert.rejects(() => prepareAuthRequest(post({}, { "sec-fetch-site": "cross-site" }), environment), { status: 403 });
  await assert.rejects(() => prepareAuthRequest(new Request("http://evil.invalid/api/auth/get-session"), environment), { status: 403 });
});

test("Next.js loopback normalization preserves strict canonical origin and Host checks", async () => {
  const request = new Request('http://localhost:3000/api/auth/get-session', { headers: { host: '127.0.0.1:3000' } });
  assert.equal((await prepareAuthRequest(request, environment)).url, `${origin}/api/auth/get-session`);
  for (const [url, host] of [['http://evil.invalid:3000/api/auth/get-session', '127.0.0.1:3000'], ['http://localhost:3001/api/auth/get-session','127.0.0.1:3000'], ['http://localhost:3000/api/auth/get-session','evil.invalid']]) {
    await assert.rejects(() => prepareAuthRequest(new Request(url, { headers: { host } }), environment), { status: 403 });
  }
});

test("local auth pages redirect aliases before form entry without expanding trusted POST origins", async () => {
  assert.equal(canonicalAuthPageUrl(environment, 'localhost:3000', '/register', {}), `${origin}/register`);
  assert.equal(canonicalAuthPageUrl(environment, '[::1]:3000', '/login', { next: '/checkout', registered:'1' }), `${origin}/login?next=%2Fcheckout&registered=1`);
  assert.equal(canonicalAuthPageUrl(environment, 'localhost:3000', '/register', { next: 'https://evil.invalid' }), `${origin}/register?next=%2Fdashboard`);
  for (const host of ['evil.invalid', 'localhost:3001', '127.0.0.1:3000', null]) assert.equal(canonicalAuthPageUrl(environment, host, '/register', {}), null);
  assert.equal(canonicalAuthPageUrl({ ...environment, nodeEnv:'production' }, 'localhost:3000', '/register', {}), null);
  const aliasPost = new Request('http://localhost:3000/api/auth/sign-up/email', { method:'POST', headers: { host:'localhost:3000', origin:'http://localhost:3000', 'content-type':'application/json' }, body:JSON.stringify({ email:'isolated@example.invalid', password:randomBytes(32).toString('hex'), name:'Test' }) });
  await assert.rejects(() => prepareAuthRequest(aliasPost, environment), { status:403, code:'UNTRUSTED_ORIGIN' });
});

test("stale-origin form errors give useful recovery without exposing internal details", async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ error:{ code:'UNTRUSTED_ORIGIN' } }, { status:403 }));
  try {
    const message = await submitAuth('sign-up/email', { email:'isolated@example.invalid', password:randomBytes(32).toString('hex') });
    assert.ok(message?.includes('Reload the page'));
    assert.ok(!message.includes('UNTRUSTED_ORIGIN'));
  } finally { fetchMock.mock.restore(); }
});

test("request policy bounds real and declared body size and checks JSON callbacks", async () => {
  await assert.rejects(() => prepareAuthRequest(post("x".repeat(MAX_AUTH_BODY_BYTES + 1)), environment), { status: 413 });
  await assert.rejects(() => prepareAuthRequest(post({}, { "content-length": String(MAX_AUTH_BODY_BYTES + 1) }), environment), { status: 413 });
  await assert.rejects(() => prepareAuthRequest(post("[]"), environment), { status: 400 });
  await assert.rejects(() => prepareAuthRequest(post("not-json"), environment), { status: 400 });
  await assert.rejects(() => prepareAuthRequest(post({ callbackURL: "https://evil.invalid" }), environment), { code: "INVALID_CALLBACK" });
  await assert.rejects(() => prepareAuthRequest(new Request(`${origin}/api/auth/get-session?callbackURL=%2F%2Fevil.invalid`), environment), { code: "INVALID_CALLBACK" });
  const prepared = await prepareAuthRequest(post({ callbackURL: "/dashboard" }), environment);
  assert.equal((await prepared.json()).callbackURL, "/dashboard");
});

test("IP headers cannot bypass rate limits unless a sanitizing proxy is explicitly selected", async () => {
  const spoofed = { "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.2", [INTERNAL_AUTH_IP_HEADER]: "203.0.113.3" };
  const prepared = await prepareAuthRequest(post({}, spoofed), environment);
  assert.match(prepared.headers.get(INTERNAL_AUTH_IP_HEADER)!, /^(?:[a-f0-9]{4}:){7}[a-f0-9]{4}$/);
  assert.equal(prepared.headers.get("x-forwarded-for"), null);
  assert.equal(prepared.headers.get("x-real-ip"), null);
  const reviewed = await prepareAuthRequest(post({}, spoofed), { ...environment, trustedIpHeader: "x-real-ip" });
  assert.equal(reviewed.headers.get(INTERNAL_AUTH_IP_HEADER), prepared.headers.get(INTERNAL_AUTH_IP_HEADER));
  const other = await prepareAuthRequest(post({email:"another@example.invalid"}, spoofed), environment);
  assert.notEqual(other.headers.get(INTERNAL_AUTH_IP_HEADER), prepared.headers.get(INTERNAL_AUTH_IP_HEADER));
});

test("disabled API and session/ownership guards fail closed with zero database operations", async () => {
  await withEnvironment({ METRO_AUTH_ENABLED: "false" }, async () => {
    for (const request of [new Request(`${origin}/api/auth/get-session`), post({ password: "never-submitted" })]) {
      const handler = request.method === "POST" ? POST : GET;
      const response = await handler(request);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal((await response.json()).error.code, "AUTH_DISABLED");
    }
    assert.throws(() => getAuth(), AuthUnavailableError);
    assert.equal(await getWebsiteSession(), null);
    await assert.rejects(() => requireWebsiteSession(), AuthUnavailableError);
    await assert.rejects(() => websiteUserScope(), AuthUnavailableError);
    assert.equal(networkAttempts, 0);
  });
});

test("enabled but incomplete configuration returns a redacted 503 without a connection", async () => {
  await withEnvironment({ METRO_AUTH_ENABLED: "true", METRO_DATABASE_URL: undefined, BETTER_AUTH_SECRET: undefined, BETTER_AUTH_URL: undefined }, async () => {
    const response = await handleAuthRequest(new Request(`${origin}/api/auth/get-session`));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "AUTH_UNAVAILABLE");
    assert.equal(networkAttempts, 0);
  });
});
