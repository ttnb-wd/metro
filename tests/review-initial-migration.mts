import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

export const migrationName = "20261020000000_init_website_auth";
export const migrationPath = `prisma/migrations/${migrationName}/migration.sql`;
export const authTables = ["metro_user", "metro_session", "metro_account", "metro_verification", "metro_rate_limit"];

export function reviewInitialMigration() {
  const directories = readdirSync("prisma/migrations", { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert.deepEqual(directories.sort(), [migrationName, "20261020010000_website_owner_foundation", "20261020020000_website_pricing", "20261021010000_website_notifications"].sort());
  const sql = readFileSync(migrationPath, "utf8");
  const statements = sql.replace(/--[^\n]*/g, "").split(";").map(statement => statement.trim()).filter(Boolean);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-1), "COMMIT");
  const tables: string[] = [];
  const indexes: string[] = [];
  const foreignKeys: string[] = [];
  for (const statement of statements.slice(1, -1)) {
    if (statement === 'CREATE SCHEMA IF NOT EXISTS "public"') continue;
    const table = statement.match(/^CREATE TABLE "(metro_[a-z_]+)" \(/);
    if (table) {
      assert.ok(authTables.includes(table[1]));
      assert.ok(!tables.includes(table[1]));
      tables.push(table[1]); continue;
    }
    const index = statement.match(/^CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "(metro_[a-z_]+)"\([^;]+\)$/);
    if (index) { assert.ok(authTables.includes(index[2])); indexes.push(index[1]); continue; }
    const fk = statement.match(/^ALTER TABLE "(metro_session|metro_account)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("userId"\) REFERENCES "metro_user"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE$/);
    if (fk) { foreignKeys.push(fk[2]); continue; }
    throw new Error("Unexpected statement in initial migration.");
  }
  assert.deepEqual(tables.sort(), [...authTables].sort());
  assert.equal(indexes.length, 10);
  assert.equal(foreignKeys.length, 2);
  assert.equal((sql.match(/PRIMARY KEY/g) ?? []).length, 5);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 4);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|INSERT|UPDATE\s+"|DELETE\s+FROM)\b/i);
  return { migrationName, sha256: createHash("sha256").update(sql).digest("hex"),
    tables: [...authTables], primaryKeys: 5, secondaryIndexes: indexes, foreignKeys, destructiveStatements: 0 };
}
