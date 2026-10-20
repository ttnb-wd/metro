import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const migrationNames=['20261020000000_init_website_auth','20261020010000_website_owner_foundation'];
export function migrationChecksums(){return Object.fromEntries(migrationNames.map(name=>[name,createHash('sha256').update(readFileSync(`prisma/migrations/${name}/migration.sql`)).digest('hex')]));}

export async function verifyFoundationArtifacts(client){
  const sql=migrationNames.map(name=>readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')).join('\n');
  const indexes=(await client.query("SELECT i.relname AS name,x.indisvalid AS valid FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=i.relnamespace WHERE n.nspname='public'")).rows;
  for(const [,name] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g))if(!indexes.some(i=>i.name===name&&i.valid))throw new Error('Missing/invalid foundation index.');
  const constraints=(await client.query("SELECT conname AS name,convalidated AS valid FROM pg_constraint WHERE connamespace='public'::regnamespace")).rows;
  for(const [,name] of sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g))if(!constraints.some(c=>c.name===name&&c.valid))throw new Error('Missing/invalid foundation constraint.');
  const triggers=(await client.query("SELECT t.tgname AS name,t.tgenabled AS enabled,c.relname AS table_name,p.proname AS function_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal")).rows;
  for(const [,name,table,fn] of sql.matchAll(/CREATE TRIGGER (\w+)[^;]+? ON "([^"]+)"[^;]+?EXECUTE FUNCTION (\w+)\(\);/g)){
    if(!triggers.some(t=>t.name===name&&t.enabled==='O'&&t.table_name===table&&t.function_name===fn))throw new Error('Missing/disabled foundation trigger.');
  }
  const functions=(await client.query("SELECT p.proname AS name,p.prosrc AS body,p.prosecdef AS definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.pronargs=0 AND p.prorettype='trigger'::regtype")).rows;
  for(const [,name,body] of sql.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/g)){
    if(!functions.some(f=>f.name===name&&!f.definer&&f.body.trim().replaceAll('\r','')===body.trim().replaceAll('\r','')))throw new Error('Foundation function differs from reviewed migration.');
  }
}
