// Run with: node --conditions=react-server --import tsx scripts/website-foundation.mts plan
// No dotenv loading. Production writes require a separately approved receipt.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { assertWebsiteTargetUrl, WEBSITE_DATABASE, WEBSITE_DIRECT_HOST } from "../src/server/db/target-policy.ts";
import { createPgPoolConfig } from "../src/server/db/connection-config.ts";
import { productionRoles, grantsSql, transferTablesSql, revokeAssignmentSql, authTables, foundationTables, createRestrictedRoles } from "./foundation/roles.mjs";
import { assignOwner } from "./foundation/assign-owner.mjs";
import { migrationNames as names, migrationChecksums, verifyFoundationArtifacts } from "./foundation/verify.mjs";

const checksums=migrationChecksums();
const ownerUuid="d7c44865-3afd-4b86-b23a-fccef97d5b08", ownerEmail="maungshinhtet@gmail.com";
const action=process.argv[2]??"plan";
const pools:Pool[]=[];
async function connection(key:string,role:string){
  const value=process.env[key];if(!value)throw new Error("Missing separately supplied operator credential.");
  assertWebsiteTargetUrl(value,role,false);
  const pool=new Pool({...createPgPoolConfig(value),max:1,query_timeout:20000,
    options:"-c lock_timeout=5000 -c statement_timeout=20000"});pool.on("error",()=>{});pools.push(pool);
  const client=await pool.connect();
  try {
    const actual=(await client.query("SELECT current_database()::text AS db,current_user::text AS role")).rows[0];
    if(actual.db!==WEBSITE_DATABASE||actual.role!==role)throw new Error("Target identity mismatch.");
    return client;
  } catch(error) { client.release(true); throw error; }
}
async function history(client:Awaited<ReturnType<typeof connection>>,complete:boolean){
  const rows=(await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
  const expected=complete?names:names.slice(0,1);
  if(JSON.stringify(rows.map(r=>r.migration_name))!==JSON.stringify(expected)||rows.some(r=>r.checksum!==checksums[r.migration_name]||!r.finished_at||r.rolled_back_at))throw new Error("Migration history mismatch; stop.");
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  if(JSON.stringify(tables)!==JSON.stringify(['_prisma_migrations',...authTables,...(complete?foundationTables:[])].sort()))throw new Error("Unexpected schema objects; stop.");
}
try {
  if(action==="plan"){
    console.log(JSON.stringify({status:"OFFLINE_PLAN_ONLY",actions:["roles","migrate","assign-owner","revoke-assignment"],roles:productionRoles,migrationChecksums:checksums,
      approvalRequired:true,backupAndRestoreEvidenceRequired:true,ownerUuid,ownerEmail,displayNameChange:"Authenticated self-service only after separate approval"},null,2));
  }else{
    if(!["roles","migrate","assign-owner","revoke-assignment"].includes(action))throw new Error("Unknown action.");
    const receipt=JSON.parse(readFileSync(process.argv[3],"utf8"));
    if(receipt.approved!==true||receipt.action!==action||receipt.host!==WEBSITE_DIRECT_HOST||receipt.database!==WEBSITE_DATABASE
      ||receipt.maintenanceApproved!==true||receipt.productionBackupReady!==true||typeof receipt.backupReference!=="string"||!receipt.backupReference.trim()
      ||typeof receipt.restoreEvidenceReference!=="string"||!receipt.restoreEvidenceReference.trim()
      ||!Number.isFinite(Date.parse(receipt.approvedAt))||Date.now()-Date.parse(receipt.approvedAt)>30*60*1000||Date.parse(receipt.approvedAt)>Date.now()
      ||JSON.stringify(receipt.migrationChecksums)!==JSON.stringify(checksums))throw new Error("Separate exact-action approval and current backup/restore evidence are required.");
    if(process.env.METRO_AUTH_ENABLED!=="false")throw new Error("Approved maintenance requires authentication disabled in this operator process.");
    // Break-glass role is never placed in website runtime. It is pinned separately
    // for the currently approved Neon administrator and only used by this tool.
    const admin=await connection("METRO_OPERATOR_DATABASE_URL","neondb_owner");
    let locked=false;
    try{
      await admin.query("SELECT pg_advisory_lock(hashtextextended('metro:foundation-rollout',0))::text");locked=true;
      const alreadyMigrated=action==='migrate'&&(await admin.query('SELECT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name=$1) AS present',[names[1]])).rows[0].present;
      await history(admin,action==="assign-owner"||action==="revoke-assignment"||alreadyMigrated);
      if(action==="assign-owner"||action==="revoke-assignment"||alreadyMigrated)await verifyFoundationArtifacts(admin);
      if(action==="roles"){
        await admin.query("BEGIN");
        try{
          await createRestrictedRoles(admin,productionRoles,{runtime:process.env.METRO_NEW_RUNTIME_PASSWORD,
            migration:process.env.METRO_NEW_MIGRATION_PASSWORD,assignment:process.env.METRO_NEW_ASSIGNMENT_PASSWORD});
          await admin.query(`REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE "${WEBSITE_DATABASE}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${WEBSITE_DATABASE}" TO "metro_runtime","metro_migrator","metro_owner_assign"`);
          await admin.query(grantsSql(productionRoles,false));
          await admin.query(transferTablesSql(productionRoles,false));
          await admin.query("COMMIT");
        }catch(error){await admin.query("ROLLBACK");throw error;}
      }else if(action==="migrate"){
        const migration=await connection("METRO_MIGRATION_DATABASE_URL",productionRoles.migration);
        migration.release();
        const child=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy","--config","prisma.migrate.config.ts"],{windowsHide:true,encoding:"utf8",timeout:120000,
          env:{...process.env,DEBUG:"",METRO_DIRECT_DATABASE_URL:process.env.METRO_MIGRATION_DATABASE_URL,METRO_AUTH_ENABLED:"false"}});
        // Never echo native CLI output: it can include a datasource URL.
        if(child.status!==0)throw new Error("Prisma migration failed; inspect sanitized diagnostics, no automatic rollback.");
        await history(admin,true);
        await verifyFoundationArtifacts(admin);
        await admin.query(grantsSql(productionRoles,true));
        if((await admin.query('SELECT count(*)::int AS n FROM metro_owner_binding')).rows[0].n>0)await admin.query(revokeAssignmentSql());
      }else if(action==="assign-owner"){
        if(receipt.ownerUuid!==ownerUuid||receipt.ownerEmail!==ownerEmail||receipt.freshLoginAndIndependentControlConfirmed!==true)throw new Error("Exact OWNER and fresh account-control approval required.");
        const operator=await connection("METRO_ASSIGNMENT_DATABASE_URL",productionRoles.assignment);
        try{await assignOwner(operator,{userId:ownerUuid,email:ownerEmail,role:productionRoles.assignment});}
        finally{operator.release();await admin.query(revokeAssignmentSql());}
      }else await admin.query(revokeAssignmentSql());
      console.log(JSON.stringify({status:"COMPLETE",action,credentialsPrinted:false,integrationActivated:false}));
    }finally{
      try{if(locked)await admin.query("SELECT pg_advisory_unlock(hashtextextended('metro:foundation-rollout',0))");}
      finally{admin.release();}
    }
  }
}catch{console.error("Foundation action refused or failed. No secrets printed. Stop and review; never reset or overwrite.");process.exitCode=1;}
finally{await Promise.all(pools.map(pool=>pool.end()));}
