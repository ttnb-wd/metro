import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthOptions } from "../src/server/auth/options.ts";
import { getPrisma } from "../src/server/db/client.ts";
import { passwordResetMessage } from "../src/server/email/password-reset.ts";
import { passwordRecoveryInput } from "../src/server/auth/password-reset.ts";
import { publicAuthPayload } from "../src/server/auth/public-response.ts";
import { prepareAuthRequest } from "../src/server/auth/request-policy.ts";

const origin = "http://127.0.0.1:3000";
const environment = { enabled: true as const, nodeEnv: "test" as const, origin, secret: randomBytes(48).toString("base64url"), databaseUrl: "postgresql://isolated:unused@127.0.0.1:1/recovery_fixture" };

test("recovery messages use a fragment, fixed origin and 15-minute single-use instructions", () => {
  const token = randomBytes(24).toString("base64url"), message = passwordResetMessage(origin, token);
  const link = message.text.split("\n").find(line => line.startsWith("http"))!;
  const url = new URL(link);
  assert.equal(url.origin, origin); assert.equal(url.pathname, "/reset-password"); assert.equal(url.search, "");
  assert.ok(url.hash.startsWith("#token=")); assert.ok(message.text.includes("15 minutes"));
  assert.throws(() => passwordResetMessage(origin + "/attacker", token));
  assert.throws(() => passwordResetMessage(origin, "invalid token"));
});

test("recovery input rejects extra privilege fields, unsafe redirects and weak passwords", async () => {
  const token = randomBytes(24).toString("base64url");
  assert.deepEqual(passwordRecoveryInput("/request-password-reset", { email: "fixture@example.invalid" }), { email: "fixture@example.invalid", redirectTo: "/reset-password" });
  for (const body of [{ email: "fixture@example.invalid", redirectTo: "https://attacker.invalid" }, { email: "fixture@example.invalid", role: "OWNER" }]) assert.equal(passwordRecoveryInput("/request-password-reset", body), null);
  for (const body of [{ token, newPassword: "short" }, { token, newPassword: "x".repeat(129) }, { token, newPassword: "valid-fixture-password", emailVerified: true }]) assert.equal(passwordRecoveryInput("/reset-password", body), null);
  await assert.rejects(prepareAuthRequest(new Request(origin + "/api/auth/request-password-reset", { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: JSON.stringify({ email: "fixture@example.invalid" }) }), environment), { code: "UNTRUSTED_ORIGIN" });
  const payload = publicAuthPayload("/reset-password", 400, { code: "INVALID_TOKEN", token });
  assert.ok(!JSON.stringify(payload).includes(token));
});

test("official Better Auth reset preserves identity and verification, revokes sessions and consumes its token", async () => {
  let verifyUrl = "", resetToken = "", resetDeliveries = 0;
  const options = createAuthOptions(environment, getPrisma(environment), async input => { verifyUrl = input.url; }, async input => { resetToken = input.token; resetDeliveries++; });
  assert.equal(options.emailAndPassword.revokeSessionsOnPasswordReset, true);
  assert.equal(options.emailAndPassword.resetPasswordTokenExpiresIn, 900);
  const auth = betterAuth({ ...options, database: memoryAdapter({ user: [], account: [], session: [], verification: [], rateLimit: [] }), rateLimit: { enabled: false } });
  const email = `${randomUUID()}@example.invalid`, password = randomBytes(24).toString("base64url"), replacement = randomBytes(24).toString("base64url");
  const post = (path: string, body: object) => auth.handler(new Request(origin + "/api/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const unknown = await post("request-password-reset", { email: `${randomUUID()}@example.invalid`, redirectTo: "/reset-password" });
  assert.equal(unknown.status, 200); assert.equal(resetDeliveries, 0);
  assert.equal((await post("sign-up/email", { email, password, name: "Recovery fixture" })).status, 200);
  assert.equal((await post("request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
  assert.equal((await post("reset-password", { token: resetToken, newPassword: replacement })).status, 200);
  assert.equal((await post("sign-in/email", { email, password: replacement })).status, 403);
  const verification = new URL(verifyUrl); verification.searchParams.delete("callbackURL");
  assert.equal((await auth.handler(new Request(verification))).status, 200);
  const login = await post("sign-in/email", { email, password: replacement }); assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const session = () => auth.handler(new Request(origin + "/api/auth/get-session", { headers: { cookie } })).then(r => r.json());
  const before = await session(); assert.ok(before.user.emailVerified);
  assert.equal((await post("request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
  const consumed = resetToken;
  assert.equal((await post("reset-password", { token: consumed, newPassword: password })).status, 200);
  assert.equal(await session(), null);
  assert.equal((await post("reset-password", { token: consumed, newPassword: replacement })).status, 400);
  assert.equal((await post("sign-in/email", { email, password: replacement })).status, 401);
  const afterLogin = await post("sign-in/email", { email, password }); assert.equal(afterLogin.status, 200);
  const after = await afterLogin.json(); assert.equal(after.user.id, before.user.id); assert.equal(after.user.emailVerified, true);
});
