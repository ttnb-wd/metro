import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildImageKitStore, imageKitConfiguration } from "../src/server/commerce/imagekit-store.ts";
import { buildEvidenceStore, evidenceStore, evidenceStorageReady, normalizeEvidence } from "../src/server/commerce/evidence-store.ts";
import { evidenceReferenceSchema } from "../src/server/commerce/evidence-reference.ts";
import { parseServerEnvironment } from "../src/server/env.ts";
import { createPgPoolConfig } from "../src/server/db/connection-config.ts";
import { imageKitFixture } from "./fake-imagekit.mts";

const source = { METRO_EVIDENCE_PROVIDER: "imagekit", METRO_IMAGEKIT_PRIVATE_KEY: `private_${randomBytes(32).toString("hex")}`, METRO_IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/metro-fixture", METRO_IMAGEKIT_FOLDER: "/metro/payment-evidence" };
async function png() { return sharp({ create: { width: 30, height: 30, channels: 3, background: "white" } }).png().toBuffer(); }

test("ImageKit accepts only scoped Metro config; generic/GOSH config and serverless disk fallback fail closed", () => {
  assert.ok(evidenceStorageReady(source));
  for (const bad of [{ ...source, METRO_IMAGEKIT_FOLDER: "/gosh" }, { ...source, METRO_IMAGEKIT_URL_ENDPOINT: "http://ik.imagekit.io/metro-fixture" }, { ...source, METRO_IMAGEKIT_URL_ENDPOINT: "https://evil.invalid/metro" }, { METRO_EVIDENCE_PROVIDER: "imagekit", IMAGEKIT_PRIVATE_KEY: source.METRO_IMAGEKIT_PRIVATE_KEY }, { VERCEL: "1", METRO_EVIDENCE_PROVIDER: "local" }]) assert.equal(evidenceStorageReady(bad), false);
});
test("private upload is verified against original bytes and signed 60-second access before a reference is returned", async () => {
  const f = imageKitFixture(), store = buildImageKitStore(imageKitConfiguration(source), { fetch: f.fetch }), bytes = await png();
  const receipt = await store.putNormalized(bytes); assert.ok(evidenceReferenceSchema.safeParse(receipt.storageRef).success);
  assert.equal(f.state.uploads, 1); assert.equal(f.state.downloads, 1); assert.deepEqual(await store.get(receipt.storageRef, receipt.sha256), bytes);
  assert.equal(f.state.downloads, 2); assert.equal(f.files.size, 1);
  await store.remove(receipt.storageRef); assert.equal(f.files.size, 0);
});
test("metadata, wrong folder, content integrity and malformed references cannot bypass private access or delete another app's files", async () => {
  const f = imageKitFixture(), store = buildImageKitStore(imageKitConfiguration(source), { fetch: f.fetch });
  const receipt = await store.putNormalized(await png()), asset = [...f.files.values()][0];
  f.state.corrupt = true; await assert.rejects(store.get(receipt.storageRef, receipt.sha256), { code: "UNAVAILABLE" }); f.state.corrupt = false;
  asset.filePath = "/gosh/private.png"; await assert.rejects(store.get(receipt.storageRef, receipt.sha256), { code: "UNAVAILABLE" }); await assert.rejects(store.remove(receipt.storageRef)); assert.equal(f.state.deletions, 0);
  const calls = f.state.calls; await assert.rejects(store.get(`imagekit:v1:../../other:${randomUUID()}`, receipt.sha256)); assert.equal(f.state.calls, calls);
});
test("provider failures cannot return a reviewable receipt, are sanitized and do not retry uploads blindly", async () => {
  const f = imageKitFixture(), store = buildImageKitStore(imageKitConfiguration(source), { fetch: f.fetch });
  f.state.failUpload = true; await assert.rejects(store.putNormalized(await png()), { code: "UNAVAILABLE", message: "Website foundation: UNAVAILABLE." }); assert.equal(f.state.uploads, 1);
  f.state.failUpload = false; f.state.publicUpload = true; await assert.rejects(store.putNormalized(await png())); assert.equal(f.files.size, 0); assert.equal(f.state.deletions, 1);
  f.state.publicUpload = false; f.state.corrupt = true; await assert.rejects(store.putNormalized(await png())); assert.equal(f.files.size, 0);
});
test("actual content, claimed MIME, size and image decoding are validated before any upload", async () => {
  const f = imageKitFixture(), network = mock.method(globalThis, "fetch", f.fetch);
  try {
    const store = evidenceStore(source);
    await assert.rejects(store.put(Buffer.from("<svg/>"), "image/png"), { code: "INVALID_REQUEST" });
    await assert.rejects(store.put(await png(), "image/jpeg"), { code: "INVALID_REQUEST" });
    await assert.rejects(store.put(Buffer.alloc(4 * 1024 * 1024 + 1), "image/png"), { code: "INVALID_REQUEST" });
    assert.equal(f.state.uploads, 0);
    const receipt = await store.put(await png(), "image/png"); assert.deepEqual(await store.get(receipt.storageRef, receipt.sha256), await normalizeEvidence(await png()));
  } finally { network.mock.restore(); }
});
test("switching new uploads to ImageKit preserves legacy proof reads locally; Vercel never pretends to have the old volume", async () => {
  const local = { METRO_EVIDENCE_DIRECTORY: await mkdtemp(join(tmpdir(), "metro-imagekit-legacy-")), METRO_EVIDENCE_ENCRYPTION_KEY: randomBytes(32).toString("hex") };
  const receipt = await buildEvidenceStore({ directory: local.METRO_EVIDENCE_DIRECTORY, key: Buffer.from(local.METRO_EVIDENCE_ENCRYPTION_KEY, "hex") }).put(await png());
  const mixed = evidenceStore({ ...source, ...local }); assert.ok((await mixed.get(receipt.storageRef, receipt.sha256)).length > 0);
  await assert.rejects(evidenceStore({ ...source, ...local, VERCEL: "1" }).get(receipt.storageRef, receipt.sha256), { code: "UNAVAILABLE" });
});
test("Vercel requires restricted pooled Neon runtime credentials and rejects operator/worker credentials", () => {
  const base = { NODE_ENV: "production", VERCEL: "1", METRO_AUTH_ENABLED: "true", METRO_DATABASE_RUNTIME_ROLE: "metro_runtime", METRO_WEBSITE_FOUNDATION_ENABLED: "true", METRO_DATABASE_URL: "postgresql://metro_runtime:isolated-password@ep-fixture-pooler.region.aws.neon.tech/neondb?sslmode=verify-full", BETTER_AUTH_SECRET: randomBytes(48).toString("hex"), BETTER_AUTH_URL: "https://metro-test.example.invalid" };
  assert.ok(parseServerEnvironment(base).enabled);
  for (const bad of [{ METRO_DATABASE_RUNTIME_ROLE: "neondb_owner" }, { METRO_COMMERCE_WORKER_DATABASE_URL: "never-expose-operator-connection" }, { METRO_NOTIFICATION_WORKER_DATABASE_URL: "never-expose-worker-connection" }, { METRO_DATABASE_URL: base.METRO_DATABASE_URL.replace("-pooler", "") }, { BETTER_AUTH_URL: "http://localhost:3000" }]) assert.throws(() => parseServerEnvironment({ ...base, ...bad }));
  const pool = createPgPoolConfig(base.METRO_DATABASE_URL, true); assert.equal(pool.max, 3); assert.equal(pool.idleTimeoutMillis, 5000); assert.equal(pool.allowExitOnIdle, true); assert.deepEqual(pool.ssl, { rejectUnauthorized: true, servername: new URL(base.METRO_DATABASE_URL).hostname });
});
