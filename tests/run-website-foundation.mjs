// Creates its own isolated PostgreSQL cluster. Never reads dotenv or an existing DB URL.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:net";
import { Client } from "pg";
import { rehearsePrisma } from "./prisma-rehearsal.mjs";
import { grantsSql, transferTablesSql, createRestrictedRoles } from "../scripts/foundation/roles.mjs";
import { rehearseBackupRestore } from "./backup-restore-rehearsal.mjs";
import { verifyFoundationArtifacts } from '../scripts/foundation/verify.mjs';
import { currentReleaseRuntimePolicy } from './current-release-role-policy.mjs';

const bin = "C:/Program Files/PostgreSQL/18/bin";
mkdirSync(".tmp", { recursive: true });
const root = mkdtempSync(resolve(".tmp/metro-pg-"));
const data = join(root, "data");
const password = randomBytes(32).toString("hex");
const appPassword = randomBytes(32).toString("hex");
const marker = randomBytes(32).toString("hex");
const restoreArchive=process.argv[2]==='--restore-only'?resolve(process.argv[3]??''):undefined;
if(restoreArchive&&(!restoreArchive.startsWith(resolve('.tmp')+'\\')||!/[\\/]metro-pg-[a-zA-Z0-9]+[\\/]foundation\.dump$/.test(restoreArchive)))throw new Error('Only an owned disposable archive is allowed.');
const releaseWorkflow = process.argv.includes("--release")||!!restoreArchive;
const prismaWorkflow = true; // Always rehearse the supported Prisma workflow, including the default entry point.
const migrationPassword = randomBytes(32).toString("hex");
const operatorPassword = randomBytes(32).toString("hex");
const database = `metro_disposable_${randomBytes(8).toString("hex")}`;
const roleMap={runtime:'metro_disposable_app',migration:'metro_disposable_migrator',assignment:'metro_disposable_operator'};
let stage = "initialize", started = false, bootstrap, finalizePrisma;
function tool(name, args, input) {
  const result = spawnSync(join(bin, name + ".exe"), args, { input, encoding: "utf8", windowsHide: true, timeout: 30000,
    env:{...process.env,PGPASSWORD:password,PGSSLMODE:'disable'} });
  if (result.status !== 0) {
    if(name === "initdb") console.error((result.stderr || "Local initdb failed.").replaceAll(password,"[REDACTED]").replaceAll(appPassword,"[REDACTED]").slice(0,1500));
    throw new Error("Disposable PostgreSQL tool failed.");
  }
  return result.stdout;
}
try {
  const passwordFile=join(root,"init-password");
  writeFileSync(passwordFile,password+"\n",{mode:0o600});
  try { tool("initdb", ["-D", data, "-U", "metro_disposable_bootstrap", `--pwfile=${passwordFile}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"]); }
  finally { unlinkSync(passwordFile); }
  const systemId = tool("pg_controldata", [data]).match(/Database system identifier:\s*(\d+)/)?.[1];
  if (!systemId) throw new Error("Missing isolated cluster identity.");
  const port = await new Promise((res, rej) => { const server=createServer(); server.on("error",rej); server.listen(0,"127.0.0.1",()=>{ const port=server.address().port; server.close(()=>res(port)); }); });
  stage = "start";
  tool("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic`, "-w", "start"]); started = true;
  bootstrap = new Client({ host: "127.0.0.1", port, user: "metro_disposable_bootstrap", password, database: "postgres" });
  await bootstrap.connect(); stage = "verify owned cluster";
  const { rows:[identity] } = await bootstrap.query("SELECT system_identifier::text AS id,current_setting('data_directory') AS directory FROM pg_control_system()");
  if(identity.id!==systemId || resolve(identity.directory)!==resolve(data)) throw new Error("Cluster identity mismatch.");
  // The only writes before schema replay are to this freshly created and verified cluster.
  if(prismaWorkflow)await createRestrictedRoles(bootstrap,roleMap,{runtime:appPassword,migration:migrationPassword,assignment:operatorPassword});
  else await bootstrap.query(`CREATE ROLE metro_disposable_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${appPassword}'`);
  await bootstrap.query(`CREATE DATABASE "${database}" OWNER metro_disposable_bootstrap`);
  if(prismaWorkflow&&!restoreArchive){
    await bootstrap.query(`CREATE DATABASE "${database}_shadow" OWNER metro_disposable_migrator`);
    await bootstrap.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC; GRANT CONNECT,CREATE ON DATABASE "${database}" TO metro_disposable_migrator; GRANT CONNECT ON DATABASE "${database}" TO metro_disposable_app,metro_disposable_operator`);
  }
  await bootstrap.end();
  bootstrap = new Client({ host: "127.0.0.1", port, user: "metro_disposable_bootstrap", password, database });
  await bootstrap.connect(); stage = "verify disposable database";
  const { rows:[target] } = await bootstrap.query("SELECT current_database() AS name,system_identifier::text AS id FROM pg_control_system()");
  if(target.name!==database || target.id!==systemId) throw new Error("Disposable database mismatch.");
  if(restoreArchive){
    stage='restore owned disposable archive';
    tool('pg_restore',['-h','127.0.0.1','-p',String(port),'-U','metro_disposable_bootstrap','-d',database,'--no-owner','--no-acl','--exit-on-error',restoreArchive]);
    await verifyFoundationArtifacts(bootstrap);
    const expected=Object.fromEntries(['20261020000000_init_website_auth','20261020010000_website_owner_foundation','20261020020000_website_pricing','20261021010000_website_notifications'].map(name=>[name,createHash('sha256').update(readFileSync(`prisma/migrations/${name}/migration.sql`)).digest('hex')]));
    const rows=(await bootstrap.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
    if(rows.length!==4||rows.some(row=>expected[row.migration_name]!==row.checksum||!row.finished_at||row.rolled_back_at))throw new Error('Restored history mismatch.');
    const users=(await bootstrap.query('SELECT email FROM metro_user')).rows;
    if(users.some(user=>!user.email.endsWith('@example.invalid')))throw new Error('Archive is not a synthetic fixture.');
    await bootstrap.query(grantsSql(roleMap,true));await bootstrap.query(transferTablesSql(roleMap,true));
    stage='isolated backup and restore';
    await rehearseBackupRestore({bootstrap,bin,root,host:'127.0.0.1',port,database,password,systemId,roleMap});
    console.log('Focused disposable archive restore, exact migration checksums, native security artifacts and backup/restore policy PASS. No migration or repository tests repeated.');
  }else{
  if(prismaWorkflow){
    stage = "standard Prisma migration workflow";
    await bootstrap.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO metro_disposable_migrator");
    const migrationUrl=`postgresql://metro_disposable_migrator:${migrationPassword}@127.0.0.1:${port}/${database}`;
    const shadowUrl=`postgresql://metro_disposable_migrator:${migrationPassword}@127.0.0.1:${port}/${database}_shadow`;
    finalizePrisma=await rehearsePrisma({bootstrap,migrationUrl,shadowUrl,marker,root,passwords:[password,appPassword,migrationPassword,operatorPassword]});
  } else {
    stage = "replay migration SQL";
    await bootstrap.query(readFileSync("prisma/migrations/20261020000000_init_website_auth/migration.sql", "utf8"));
    await bootstrap.query(readFileSync("prisma/migrations/20261020010000_website_owner_foundation/migration.sql", "utf8"));
  }
  await bootstrap.query("CREATE TABLE metro_disposable_marker (slot integer PRIMARY KEY CHECK(slot=1),token text NOT NULL)");
  await bootstrap.query("INSERT INTO metro_disposable_marker VALUES(1,$1)",[marker]);
  if(prismaWorkflow){
    await bootstrap.query(grantsSql(roleMap,true));
    await bootstrap.query(transferTablesSql(roleMap,true));
  }else{
    const applicationTables=[...readFileSync("prisma/schema.prisma","utf8").matchAll(/@@map\("(metro_[a-z_]+)"\)/g)].map(match=>'"'+match[1]+'"').join(',');
    await bootstrap.query(`GRANT USAGE ON SCHEMA public TO metro_disposable_app; GRANT SELECT ON TABLE ${applicationTables} TO metro_disposable_app;
      GRANT INSERT,UPDATE,DELETE ON metro_user,metro_session,metro_account,metro_verification,metro_rate_limit TO metro_disposable_app;
      GRANT INSERT,UPDATE ON metro_website_order,metro_support_issue,metro_website_request,metro_website_operation,metro_website_outbox TO metro_disposable_app;
      GRANT INSERT ON metro_payment_evidence,metro_payment_decision,metro_issue_event,metro_owner_audit TO metro_disposable_app`);
  }
  await bootstrap.query('GRANT SELECT ON metro_disposable_marker TO metro_disposable_app');
  await currentReleaseRuntimePolicy(bootstrap,roleMap);
  const operatorUrl=prismaWorkflow?`postgresql://metro_disposable_operator:${operatorPassword}@127.0.0.1:${port}/${database}`:"";
  stage = "repository tests";
  const appUrl = `postgresql://metro_disposable_app:${appPassword}@127.0.0.1:${port}/${database}`;
  const bootstrapUrl = `postgresql://metro_disposable_bootstrap:${password}@127.0.0.1:${port}/${database}`;
  const result = spawnSync(process.execPath, ["--import", "./tests/register-server-only.mjs", "--import", "tsx", "--test", "--test-concurrency=1", ...(prismaWorkflow?["tests/database-role-security.test.mts"]:[]), "tests/website-repositories.test.mts", ...(releaseWorkflow?['tests/restricted-auth.test.mts']:[])], {
    windowsHide: true, stdio: "inherit", env: { ...process.env, METRO_DATABASE_URL: "", METRO_DIRECT_DATABASE_URL: "", DATABASE_URL: "", METRO_AUTH_ENABLED: "false",
      METRO_DISPOSABLE_APP_URL: appUrl, METRO_DISPOSABLE_BOOTSTRAP_URL: bootstrapUrl, METRO_DISPOSABLE_MARKER: marker,
      METRO_DISPOSABLE_OPERATOR_URL:operatorUrl, METRO_DISPOSABLE_MIGRATION_ROLE:prismaWorkflow?"metro_disposable_migrator":"" },
  });
  if (result.status !== 0) throw new Error("Repository tests failed.");
  if(finalizePrisma){stage="post-fixture Prisma safety checks";await finalizePrisma();}
  if(releaseWorkflow){stage="isolated backup and restore";await rehearseBackupRestore({bootstrap,bin,root,host:'127.0.0.1',port,database,password,systemId,roleMap});}
  console.log(`Disposable ${prismaWorkflow?"Prisma migration workflow, role security":"migration SQL replay"} and repository tests: PASS. No production database contacted.`);
  }
} catch (error) {
  if(error instanceof Error && /^Backup rehearsal stage: [a-z0-9-]+$/.test(error.message))console.error(error.message);
  console.error(`Disposable verification failed at: ${stage}. No production fallback attempted.`); process.exitCode=1;
} finally {
  try { await bootstrap?.end(); } catch { /* Owned disposable process cleanup only. */ }
  if(started) { try { tool("pg_ctl",["-D",data,"-m","fast","-w","stop"]); } catch { console.error("Disposable PostgreSQL cleanup requires attention."); process.exitCode=1; } }
}
