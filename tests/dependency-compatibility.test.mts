import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { attachDatabasePool } from "@vercel/functions/db-connections";
const require = createRequire(import.meta.url);

test("the exact Vercel CLI-config dependency resolves patched Zod and preserves its config validation", () => {
  const entry = require.resolve("@vercel/cli-config"), cliRequire = createRequire(entry);
  assert.equal(cliRequire("zod/package.json").version, "4.6.7");
  const { globalConfigSchema, authConfigSchema } = require(join(dirname(entry), "schema.js"));
  assert.ok(globalConfigSchema.safeParse({ credStorage: "file", telemetry: { enabled: false }, currentTeam: "fixture", updates: { auto: false } }).success);
  assert.equal(globalConfigSchema.safeParse({ credStorage: "unsupported-storage" }).success, false);
  assert.ok(authConfigSchema.safeParse({ token: "nonsecret-fixture", expiresAt: 123 }).success);
  assert.equal(authConfigSchema.safeParse({ expiresAt: "invalid" }).success, false);
});

test("the supported pool-only SDK export attaches lifecycle handling without OIDC or a connection", () => {
  const pool = Object.assign(new EventEmitter(), { options: { idleTimeoutMillis: 10 }, connect() { throw new Error("No database connection allowed."); } });
  attachDatabasePool(pool);
  assert.equal(pool.listenerCount("release"), 1);
});
