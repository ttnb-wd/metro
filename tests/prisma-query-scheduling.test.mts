import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { serializeTransaction } from "../src/server/db/prisma-pg.ts";

type Transaction = Parameters<typeof serializeTransaction>[0];
const query = { sql: "SELECT 1", args: [], argTypes: [] };

function fixture() {
  const calls: string[] = [];
  let active = 0, maximum = 0;
  async function step<T>(name: string, result: T) {
    active++; maximum = Math.max(maximum, active); calls.push(name);
    await setImmediate(); active--;
    return result;
  }
  const raw: Transaction = {
    provider: "postgres", adapterName: "@prisma/adapter-pg", options: { usePhantomQuery: false },
    queryRaw: () => step("read", { columnNames: [], columnTypes: [], rows: [] }),
    executeRaw: () => step("write", 1),
    commit: () => step("commit", undefined),
    rollback: () => step("rollback", undefined),
    createSavepoint: () => step("savepoint", undefined),
    rollbackToSavepoint: () => step("rollback savepoint", undefined),
    releaseSavepoint: () => step("release savepoint", undefined),
  };
  return { raw, calls, maximum: () => maximum };
}

test("relation reads, writes, savepoints and release are sequential within one transaction", async () => {
  const f = fixture(), tx = serializeTransaction(f.raw);
  await Promise.all([
    tx.queryRaw(query), tx.executeRaw(query), tx.createSavepoint!("one"),
    tx.queryRaw(query), tx.rollbackToSavepoint!("one"), tx.releaseSavepoint!("one"), tx.commit(),
  ]);
  assert.equal(f.maximum(), 1);
  assert.deepEqual(f.calls, ["read", "write", "savepoint", "read", "rollback savepoint", "release savepoint", "commit"]);
});

test("a failed query still rejects its caller and rollback waits before releasing the connection", async () => {
  const f = fixture(), failure = new Error("Isolated query failure");
  f.raw.queryRaw = async () => { f.calls.push("failed read"); await setImmediate(); throw failure; };
  const tx = serializeTransaction(f.raw);
  const read = tx.queryRaw(query), rollback = tx.rollback();
  await assert.rejects(read, error => error === failure);
  await rollback;
  assert.deepEqual(f.calls, ["failed read", "rollback"]);
});

test("independent transactions are not serialized globally", async () => {
  const a = fixture(), b = fixture();
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  for (const f of [a, b]) f.raw.queryRaw = async () => { started++; await gate; return { columnNames: [], columnTypes: [], rows: [] }; };
  const reads = [serializeTransaction(a.raw).queryRaw(query), serializeTransaction(b.raw).queryRaw(query)];
  await setImmediate();
  assert.equal(started, 2);
  release(); await Promise.all(reads);
});
