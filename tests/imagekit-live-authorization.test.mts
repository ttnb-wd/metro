// Real ImageKit reads of one generated fixture; all database records and sessions
// exist only in the runner's identity-verified disposable PostgreSQL cluster.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaClient } from "../src/server/db/generated/client.ts";
import { MetroPrismaPg } from "../src/server/db/prisma-pg.ts";
import { createPgPoolConfig } from "../src/server/db/connection-config.ts";
import { buildRepositories } from "../src/server/website/repositories.ts";
import { GET as proofFile } from "../src/app/api/evidence/[id]/route.ts";

test("actual proof route authorizes OWNER preview/download and rejects unauthorized or stale sessions", async t => {
  const path = resolve(process.env.METRO_IMAGEKIT_LIVE_MANIFEST ?? "");
  assert.equal(dirname(path), resolve(".tmp")); assert.match(basename(path), /^imagekit-live-[a-f0-9-]+\.json$/);
  const proof = z.object({ storageRef: z.string().regex(/^imagekit:v1:/), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() }).parse(JSON.parse(readFileSync(path, "utf8")));
  const urls = [process.env.METRO_DISPOSABLE_APP_URL!, process.env.METRO_DISPOSABLE_BOOTSTRAP_URL!];
  for (const raw of urls) { const url = new URL(raw); assert.equal(url.hostname, "127.0.0.1"); assert.match(url.pathname, /^\/metro_disposable_[a-f0-9]{16}$/); }
  const [app, operator] = urls.map(url => new PrismaClient({ adapter: new MetroPrismaPg(createPgPoolConfig(url)), log: [], errorFormat: "minimal" }));
  type Session = { user: { id: string; emailVerified: boolean }; session: { id: string; userId: string; createdAt: Date; expiresAt: Date } };
  let session: Session | null = null;
  const context = { app, session, secret: randomBytes(48).toString("hex"), repositories: () => buildRepositories(app, async () => session) };
  (globalThis as unknown as { metroCommerceE2e: unknown }).metroCommerceE2e = context;
  const sessions: Session[] = [];
  const actor = (value: Session | null) => { session = value; (context as { session: Session | null }).session = value; };
  try {
    for (let index = 0; index < 3; index++) {
      const id = randomUUID(); await operator.user.create({ data: { id, name: "Disposable storage check", email: `${id}@example.invalid`, emailVerified: true } });
      const persisted = await operator.session.create({ data: { userId: id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
      sessions.push({ user: { id, emailVerified: true }, session: persisted });
    }
    await operator.ownerBinding.create({ data: { slot: 1, userId: sessions[0].user.id } });
    const quoteId = randomUUID();
    const order = await operator.websiteOrder.create({ data: { userId: sessions[1].user.id, quoteId,
      quoteSnapshot: { id: quoteId, owner: { issuer: "metro-website", subject: sessions[1].user.id }, totalMmk: "1", fixture: true }, totalMmk: "1" } });
    const evidence = await operator.paymentEvidence.create({ data: { ...proof, orderId: order.id, userId: order.userId, mediaType: "image/png" } });
    const read = (query = "") => proofFile(new Request(`https://metro-e2e.invalid/api/evidence/${evidence.id}${query}`), { params: Promise.resolve({ id: evidence.id }) });
    await t.test("anonymous access fails", async () => { actor(null); assert.equal((await read("?view=1")).status, 401); });
    await t.test("unrelated CUSTOMER cannot preview or download", async () => { actor(sessions[2]); assert.equal((await read("?view=1")).status, 404); assert.equal((await read()).status, 404); });
    await t.test("recent OWNER previews exact original private bytes", async () => {
      actor(sessions[0]); const response = await read("?view=1"); assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition")!, /^inline/);
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), proof.sha256);
    });
    await t.test("recent OWNER downloads exact original private bytes", async () => {
      const response = await read(); assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition")!, /^attachment/);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length, proof.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), proof.sha256);
      assert.equal(await operator.websiteAuditEvent.count({ where: { action: "EVIDENCE_READ" } }), 2);
    });
    await t.test("own CUSTOMER previews and downloads; other customer remains denied", async () => {actor(sessions[1]);for(const query of ["?view=1", ""]){const r=await read(query);assert.equal(r.status,200);assert.equal(createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex"),proof.sha256);}actor(sessions[0]);});
    await t.test("OWNER access expires after the recent-auth window", async () => {
      await operator.session.update({ where: { id: sessions[0].session.id }, data: { createdAt: new Date(Date.now() - 301000) } });
      assert.equal((await read("?view=1")).status, 403);
    });
    await t.test("all fixture payment/order records remain unapproved with no fulfilment", async () => {
      const unchanged = await operator.websiteOrder.findUniqueOrThrow({ where: { id: order.id } }); assert.equal(unchanged.payment, "UNVERIFIED"); assert.equal(unchanged.state, "AWAITING_PAYMENT");
      assert.equal(await operator.paymentDecision.count(), 0); assert.equal(await operator.websiteOperation.count(), 0);
    });
  } finally { await app.$disconnect(); await operator.$disconnect(); }
});
