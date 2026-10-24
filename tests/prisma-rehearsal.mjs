import { spawnSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { join } from "node:path";
import {verifyFoundationArtifacts} from '../scripts/foundation/verify.mjs';

export const migrationNames = ["20261020000000_init_website_auth", "20261020010000_website_owner_foundation", "20261020020000_website_pricing", "20261021010000_website_notifications"];
export async function rehearsePrisma({ bootstrap, migrationUrl, shadowUrl, marker, root, passwords }) {
  const scrub = value => passwords.reduce((text, password) => text.replaceAll(password,"[REDACTED]"), String(value))
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,"[REDACTED CONNECTION]");
  const env = { ...process.env, DEBUG: "", METRO_DATABASE_URL: "", METRO_DIRECT_DATABASE_URL: "", DATABASE_URL: "", METRO_AUTH_ENABLED: "false",
    METRO_DISPOSABLE_MIGRATION_URL: migrationUrl, METRO_DISPOSABLE_SHADOW_URL: shadowUrl, METRO_DISPOSABLE_VERIFIED: marker };
  function cli(args) {
    const result=spawnSync(process.execPath,["node_modules/prisma/build/index.js",...args,"--config","tests/prisma.disposable.config.ts"],{env,windowsHide:true,encoding:"utf8",timeout:60000,maxBuffer:4*1024*1024});
    const output=scrub((result.stdout??"")+"\n"+(result.stderr??""));
    appendFileSync(join(root,"prisma-rehearsal.log"),args.join(" ")+"\n"+output+"\n");
    if(result.status!==0){console.error(output.slice(-4500));throw new Error("Prisma rehearsal command failed.");}
    return output;
  }
  cli(["migrate","deploy"]);
  const history = async () => (await bootstrap.query(`SELECT id,migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM public._prisma_migrations ORDER BY migration_name`)).rows;
  const before = await history();
  assert.deepEqual(before.map(row=>row.migration_name),migrationNames);
  for(const row of before){
    assert.equal(row.checksum,createHash("sha256").update(readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`)).digest("hex"));
    assert.ok(row.finished_at);assert.equal(row.rolled_back_at,null);assert.equal(row.applied_steps_count,1);
  }
  cli(["migrate","deploy"]);
  assert.deepEqual(await history(),before);
  const status=cli(["migrate","status"]);
  assert.match(status,/up to date/i);
  // Before marker/fixtures: compare both the full migration chain and modeled schema.
  cli(["migrate","diff","--from-migrations","prisma/migrations","--to-config-datasource","--exit-code","--script"]);
  cli(["migrate","diff","--from-config-datasource","--to-schema","prisma/schema.prisma","--exit-code","--script"]);
  const sql=migrationNames.map(name=>readFileSync(`prisma/migrations/${name}/migration.sql`,"utf8")).join("\n");
  await verifyFoundationArtifacts(bootstrap);
  const tables=[...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match=>match[1]);
  const actualTables=(await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(row=>row.tablename).sort();
  assert.deepEqual(actualTables,[...tables,"_prisma_migrations"].sort());
  const indexes=(await bootstrap.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).rows.map(row=>row.indexname);
  for(const [,name] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g))assert.ok(indexes.includes(name),`Missing index: ${name}`);
  const constraints=(await bootstrap.query("SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace")).rows.map(row=>row.conname);
  for(const [,name] of sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g))assert.ok(constraints.includes(name),`Missing constraint: ${name}`);
  const triggers=(await bootstrap.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).rows.map(row=>row.tgname);
  for(const [,name] of sql.matchAll(/CREATE TRIGGER (\w+)/g))assert.ok(triggers.includes(name),`Missing trigger: ${name}`);
  console.log("Prisma deploy chain, checksums/history, repeat deploy, status, two drift comparisons and schema invariants: PASS.");
  return async () => {
    const counts=async()=>{const result=[];for(const table of tables)result.push((await bootstrap.query(`SELECT count(*)::text AS n FROM "${table}"`)).rows[0].n);return result;};
    const dataBefore=await counts();
    cli(["migrate","deploy"]);
    assert.deepEqual(await history(),before);assert.deepEqual(await counts(),dataBefore);
    // The test-only identity marker is no longer needed after the repository process exits.
    // Remove only this harness-created table before the final modeled-schema drift check.
    await bootstrap.query("DROP TABLE metro_disposable_marker");
    cli(["migrate","diff","--from-config-datasource","--to-schema","prisma/schema.prisma","--exit-code","--script"]);
    console.log("Post-fixture repeat deployment preserved all rows/history; final Prisma drift check: PASS.");
  };
}
