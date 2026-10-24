import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { grantsSql,transferTablesSql,revokeAssignmentSql } from '../scripts/foundation/roles.mjs';
import { currentReleaseRuntimePolicy } from './current-release-role-policy.mjs';

export function canonicalConstraints(rows) {
  // pg_dump reparses BETWEEN's nested AND into a flat AND. Normalize only
  // these reviewed positive range prefixes; never discard general parentheses.
  const ranges={metro_evidence_values:['bytes',1,10485760],metro_issue_event_values:['attempt',0,3],metro_issue_values:['attempts',0,3]};
  return rows.map(row=>{
    const range=ranges[row.conname];if(!range)return row;
    const [column,min,max]=range;
    return {...row,definition:row.definition.replace(`CHECK ((((${column} >= ${min}) AND (${column} <= ${max})) AND `,
      `CHECK (((${column} >= ${min}) AND (${column} <= ${max}) AND `)};
  });
}

export async function rehearseBackupRestore({bootstrap,bin,root,host,port,database,password,systemId,roleMap}) {
  let stage='target-guard';
  try {
  if(host!=='127.0.0.1'||!/^metro_disposable_[a-f0-9]{16}$/.test(database))throw new Error('Disposable backup guard failed.');
  const identity=(await bootstrap.query("SELECT current_database() AS db,system_identifier::text AS id FROM pg_control_system()")).rows[0];
  assert.equal(identity.db,database);assert.equal(identity.id,systemId);
  const archive=join(root,'foundation.dump');
  function command(name,args){
    const result=spawnSync(join(bin,`${name}.exe`),args,{windowsHide:true,encoding:'utf8',timeout:30000,
      env:{...process.env,PGPASSWORD:password,PGSSLMODE:'disable',PGOPTIONS:'-c statement_timeout=20000'}});
    if(result.status!==0)throw new Error('Isolated backup/restore command failed; no raw output exposed.');
  }
  stage='pg-dump';
  command('pg_dump',['-h',host,'-p',String(port),'-U','metro_disposable_bootstrap','-d',database,'--format=custom','--no-owner','--no-acl','--file',archive]);
  const restoreDatabase=database+'_restore';
  await bootstrap.query(`CREATE DATABASE "${restoreDatabase}" OWNER metro_disposable_bootstrap`);
  const restored=new Client({host,port,user:'metro_disposable_bootstrap',password,database:restoreDatabase});
  await restored.connect();
  try{
    const target=(await restored.query("SELECT current_database() AS db,system_identifier::text AS id FROM pg_control_system()")).rows[0];
    assert.equal(target.db,restoreDatabase);assert.equal(target.id,systemId);
    stage='pg-restore';
    command('pg_restore',['-h',host,'-p',String(port),'-U','metro_disposable_bootstrap','-d',restoreDatabase,'--no-owner','--no-acl','--exit-on-error',archive]);
    const tables=(await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
    stage='restored-row-fingerprints';assert.equal(tables.length,19);
    for(const table of tables){
      assert.match(table,/^(metro_[a-z_]+|_prisma_migrations)$/);
      const sql=`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${table}" t`;
      assert.deepEqual((await restored.query(sql)).rows,(await bootstrap.query(sql)).rows,`Restored row fingerprint: ${table}`);
    }
    stage='restored-schema-definitions';
    let catalog=0;
    for(const sql of [
      "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname",
      "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname,definition",
      "SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname",
      "SELECT proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'metro_%' ORDER BY proname",
    ]){
      stage=`restored-schema-catalog-${++catalog}`;
      let actual=(await restored.query(sql)).rows,expected=(await bootstrap.query(sql)).rows;
      if(catalog===2){actual=canonicalConstraints(actual);expected=canonicalConstraints(expected);}
      if(JSON.stringify(actual)!==JSON.stringify(expected))writeFileSync(join(root,`restore-schema-diff-${catalog}.json`),JSON.stringify({expected,actual},null,2));
      assert.deepEqual(actual,expected);
    }
    // pg_dump intentionally excludes role secrets/ACLs. Restore the reviewed
    // object policy separately; global roles already exist in this owned cluster.
    stage='reapply-role-policy';
    await restored.query(grantsSql(roleMap,true));await restored.query(transferTablesSql(roleMap,true));
    await restored.query(revokeAssignmentSql(roleMap));
    await currentReleaseRuntimePolicy(restored,roleMap);
    const ownership=(await restored.query("SELECT tableowner FROM pg_tables WHERE schemaname='public'")).rows;
    assert.equal(ownership.length,19);assert.ok(ownership.every(row=>row.tableowner===roleMap.migration));
    assert.equal((await restored.query("SELECT has_table_privilege($1,'metro_pricing_release','UPDATE,DELETE') AS allowed",[roleMap.runtime])).rows[0].allowed,false);
    assert.equal((await restored.query("SELECT has_column_privilege($1,'metro_website_notification','readAt','UPDATE') AS allowed",[roleMap.runtime])).rows[0].allowed,true);
    assert.equal((await restored.query("SELECT has_column_privilege($1,'metro_website_notification','emailState','UPDATE') AS allowed",[roleMap.runtime])).rows[0].allowed,false);
    assert.equal((await restored.query("SELECT has_table_privilege($1,'metro_owner_binding','INSERT') AS allowed",[roleMap.runtime])).rows[0].allowed,false);
    assert.equal((await restored.query("SELECT has_table_privilege($1,'metro_owner_binding','INSERT') AS allowed",[roleMap.assignment])).rows[0].allowed,false);
    writeFileSync(join(root,'restore-evidence.json'),JSON.stringify({scope:'OWNED_DISPOSABLE_CLUSTER_ONLY',database,restoreDatabase,
      archiveSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),tables:tables.length,rowFingerprintsEqual:true,
      indexesConstraintsTriggersFunctionsEqual:true,grantsRestored:true,productionBackupVerified:false},null,2));
    console.log('Isolated pg_dump/pg_restore: 19 table data fingerprints, migration history, indexes, constraints, triggers, functions and reapplied role restrictions PASS. This is not a production backup.');
  }finally{await restored.end();}
  } catch { throw new Error(`Backup rehearsal stage: ${stage}`); }
}
