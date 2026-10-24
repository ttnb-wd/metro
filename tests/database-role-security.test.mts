import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

const appUrl=process.env.METRO_DISPOSABLE_APP_URL,operatorUrl=process.env.METRO_DISPOSABLE_OPERATOR_URL;
if(!appUrl||!operatorUrl){test("role rehearsal requires verified disposable cluster",{skip:true},()=>{});}
else{
  for(const value of [appUrl,operatorUrl]){const url=new URL(value);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/metro_disposable_[a-f0-9]{16}$/);}
  const runtime=new Client({connectionString:appUrl}),operator=new Client({connectionString:operatorUrl});
  await runtime.connect();await operator.connect();
  after(async()=>{await runtime.end();await operator.end();});
  const denied=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='42501';
  test("runtime and operator lack elevated privileges and migration-role membership",async()=>{
    for(const client of [runtime,operator]){
      const {rows:[flags]}=await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,pg_has_role(current_user,'metro_disposable_migrator','MEMBER') AS migration_member FROM pg_roles WHERE rolname=current_user");
      assert.deepEqual(flags,{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false,migration_member:false});
      assert.equal((await client.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS allowed")).rows[0].allowed,false);
    }
  });
  test("runtime cannot mutate OWNER binding, migration history, schema or triggers",async()=>{
    for(const sql of ["INSERT INTO metro_owner_binding(slot,\"userId\") VALUES(1,'not-a-user')","UPDATE metro_owner_binding SET slot=1","DELETE FROM metro_owner_binding","TRUNCATE metro_owner_binding","SELECT * FROM _prisma_migrations","DELETE FROM _prisma_migrations","CREATE TABLE public.metro_forbidden(id int)","ALTER TABLE metro_owner_binding DISABLE TRIGGER metro_owner_immutable"]){
      await assert.rejects(runtime.query(sql),denied);
    }
  });
  test("runtime has only required business writes; entitlement projections and retained history cannot be deleted",async()=>{
    for(const table of ["metro_website_order","metro_payment_evidence","metro_payment_decision","metro_issue_event","metro_owner_audit","metro_website_request","metro_website_operation","metro_website_outbox","metro_service_reference"]){
      assert.equal((await runtime.query("SELECT has_table_privilege(current_user,$1,'DELETE') AS allowed",[table])).rows[0].allowed,false,table);
    }
    for(const privilege of ["INSERT","UPDATE","TRUNCATE"]){
      assert.equal((await runtime.query("SELECT has_table_privilege(current_user,'metro_service_reference',$1) AS allowed",[privilege])).rows[0].allowed,false);
    }
    for(const table of ["metro_payment_decision","metro_owner_audit","metro_issue_event"]){
      assert.equal((await runtime.query("SELECT has_table_privilege(current_user,$1,'INSERT') AS allowed",[table])).rows[0].allowed,true);
      assert.equal((await runtime.query("SELECT has_table_privilege(current_user,$1,'UPDATE') AS allowed",[table])).rows[0].allowed,false);
    }
  });
  test("manual operator can inspect identity and insert binding but cannot read password hashes or rewrite accounts",async()=>{
    assert.equal((await operator.query("SELECT has_table_privilege(current_user,'metro_owner_binding','INSERT') AS allowed")).rows[0].allowed,true);
    await operator.query('SELECT id,name,email FROM metro_user LIMIT 0');
    await operator.query('SELECT "userId","providerId" FROM metro_account LIMIT 0');
    await assert.rejects(operator.query('SELECT password FROM metro_account'),denied);
    await assert.rejects(operator.query('UPDATE metro_user SET name=name'),denied);
    await assert.rejects(operator.query('UPDATE metro_owner_binding SET slot=1'),denied);
    await assert.rejects(operator.query('DELETE FROM metro_owner_audit'),denied);
  });
  test("migration role owns application tables; runtime owns no schema objects",async()=>{
    const {rows}=await runtime.query("SELECT tablename,tableowner FROM pg_tables WHERE schemaname='public' AND tablename<>'metro_disposable_marker'");
    assert.equal(rows.length,19);assert.ok(rows.every(row=>row.tableowner==='metro_disposable_migrator'));
  });
}
