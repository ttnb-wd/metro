// Owns an isolated loopback PostgreSQL cluster; never loads dotenv or production credentials.
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { Client } from 'pg';
import { createRestrictedRoles, grantsSql, revokeAssignmentSql } from '../scripts/foundation/roles.mjs';
import { pricingGrantsSql } from '../scripts/foundation/pricing-grants.mjs';

const bin='C:/Program Files/PostgreSQL/18/bin';
mkdirSync('.tmp',{recursive:true});const root=mkdtempSync(resolve('.tmp/admin-pricing-pg-')),data=join(root,'data');
const password=randomBytes(32).toString('hex'),runtimePassword=randomBytes(32).toString('hex'),migrationPassword=randomBytes(32).toString('hex'),assignmentPassword=randomBytes(32).toString('hex');
const workerPassword=randomBytes(32).toString('hex');
const database=`metro_disposable_${randomBytes(8).toString('hex')}`,marker=randomBytes(32).toString('hex');
const roles={runtime:'metro_disposable_app',migration:'metro_disposable_migrator',assignment:'metro_disposable_operator'};
let started=false,connection,stage='initialize';
const scrub=text=>[password,runtimePassword,migrationPassword,assignmentPassword,workerPassword].reduce((s,value)=>s.replaceAll(value,'[REDACTED]'),String(text)).replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[REDACTED CONNECTION]');
const env={...process.env,METRO_AUTH_ENABLED:'false',METRO_DATABASE_URL:'',METRO_DIRECT_DATABASE_URL:'',DATABASE_URL:'',DEBUG:''};
function tool(name,args){const result=spawnSync(join(bin,name+'.exe'),args,{windowsHide:true,encoding:'utf8',timeout:30000,env:{...env,PGPASSWORD:password,PGSSLMODE:'disable'}});if(result.status!==0)throw new Error('Isolated PostgreSQL tool failed.');return result.stdout;}
try{
  const passfile=join(root,'bootstrap-password');writeFileSync(passfile,password+'\n',{mode:0o600});
  try{tool('initdb',['-D',data,'-U','metro_disposable_bootstrap',`--pwfile=${passfile}`,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{unlinkSync(passfile);}
  const systemId=tool('pg_controldata',[data]).match(/Database system identifier:\s*(\d+)/)?.[1];if(!systemId)throw new Error('No owned cluster identity.');
  const port=await new Promise((res,rej)=>{const server=createServer();server.on('error',rej);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>res(p));});});
  tool('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
  connection=new Client({host:'127.0.0.1',port,user:'metro_disposable_bootstrap',password,database:'postgres'});await connection.connect();
  const identity=(await connection.query("SELECT system_identifier::text AS id,current_setting('data_directory') AS directory FROM pg_control_system()")).rows[0];
  if(identity.id!==systemId||resolve(identity.directory)!==resolve(data))throw new Error('Owned cluster mismatch.');
  await createRestrictedRoles(connection,roles,{runtime:runtimePassword,migration:migrationPassword,assignment:assignmentPassword});
  await connection.query(`CREATE DATABASE "${database}" OWNER metro_disposable_migrator`);
  await connection.query(`CREATE DATABASE "${database}_shadow" OWNER metro_disposable_migrator`);
  await connection.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${database}" TO metro_disposable_app,metro_disposable_operator`);
  await connection.end();
  connection=new Client({host:'127.0.0.1',port,user:'metro_disposable_bootstrap',password,database});await connection.connect();
  if((await connection.query('SELECT current_database() AS name,system_identifier::text AS id FROM pg_control_system()')).rows.some(row=>row.name!==database||row.id!==systemId))throw new Error('Disposable database mismatch.');
  await connection.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO metro_disposable_migrator');
  const migrationUrl=`postgresql://metro_disposable_migrator:${migrationPassword}@127.0.0.1:${port}/${database}`;
  const migrationEnv={...env,METRO_DISPOSABLE_MIGRATION_URL:migrationUrl,METRO_DISPOSABLE_SHADOW_URL:migrationUrl+'_shadow',METRO_DISPOSABLE_VERIFIED:marker};
  function prisma(args){const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args,'--config','tests/prisma.disposable.config.ts'],{env:migrationEnv,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});writeFileSync(join(root,'last-prisma-result.log'),scrub((result.stdout??'')+'\n'+(result.stderr??'')));if(result.status!==0)throw new Error('Disposable Prisma command failed.');}
  stage='standard Prisma migration rehearsal';prisma(['migrate','deploy']);
  const history=async()=>(await connection.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
  const before=await history();const migrations=readdirSync('prisma/migrations').filter(name=>/^\d{14}_/.test(name)).sort();
  if(JSON.stringify(before.map(row=>row.migration_name))!==JSON.stringify(migrations))throw new Error('Migration chain mismatch.');
  for(const row of before)if(!row.finished_at||row.rolled_back_at||row.checksum!==createHash('sha256').update(readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`)).digest('hex'))throw new Error('Migration checksum mismatch.');
  prisma(['migrate','deploy']);if(JSON.stringify(await history())!==JSON.stringify(before))throw new Error('Repeat migration was not stable.');
  prisma(['migrate','status']);prisma(['migrate','diff','--from-migrations','prisma/migrations','--to-config-datasource','--exit-code','--script']);
  prisma(['migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code','--script']);
  await connection.query(grantsSql(roles,true));await connection.query(pricingGrantsSql(roles));await connection.query(revokeAssignmentSql(roles));
  await connection.query(`CREATE ROLE metro_disposable_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${workerPassword}'`);
  await connection.query(`GRANT CONNECT ON DATABASE "${database}" TO metro_disposable_worker`);
  await connection.query(readFileSync('scripts/foundation/commerce-worker-grants.sql','utf8').replaceAll('metro_commerce_worker','metro_disposable_worker'));
  stage='OWNER, pricing, idempotency and repository tests';
  const result=spawnSync(process.execPath,['--import','./tests/register-server-only.mjs','--import','tsx','--test','--test-concurrency=1','tests/admin-pricing-db.test.mts','tests/commerce-db.test.mts'],{env:{...env,METRO_DISPOSABLE_WORKER_URL:`postgresql://metro_disposable_worker:${workerPassword}@127.0.0.1:${port}/${database}`,METRO_DISPOSABLE_APP_URL:`postgresql://metro_disposable_app:${runtimePassword}@127.0.0.1:${port}/${database}`,METRO_DISPOSABLE_BOOTSTRAP_URL:`postgresql://metro_disposable_bootstrap:${password}@127.0.0.1:${port}/${database}`},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
  console.log(scrub(result.stdout??''));if(result.status!==0){console.error(scrub(result.stderr??''));throw new Error('Disposable repository tests failed.');}
  console.log('PASS: standard Prisma deploy, checksums, repeat deploy, status, migration/schema drift and restricted-role admin/pricing tests. No production database contacted.');
}catch{console.error(`Isolated admin/pricing verification failed at ${stage}. No production fallback attempted.`);process.exitCode=1;}
finally{try{await connection?.end();}catch{}if(started){try{tool('pg_ctl',['-D',data,'-m','fast','-w','stop']);}catch{console.error('Owned PostgreSQL cleanup requires attention.');process.exitCode=1;}}}
