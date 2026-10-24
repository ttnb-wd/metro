import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
const bin='C:/Program Files/PostgreSQL/18/bin';mkdirSync('.tmp',{recursive:true});const root=mkdtempSync(resolve('.tmp/receipt-pg-')),data=join(root,'data'),password=randomBytes(32).toString('hex');let started=false;
const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{PGPASSWORD:password,PGSSLMODE:'disable',NODE_ENV:'test'});
function tool(n,args){const r=spawnSync(join(bin,n+'.exe'),args,{env,windowsHide:true,encoding:'utf8',timeout:30000});if(r.status!==0)throw Error('Isolated PostgreSQL control failed');return r.stdout;}
try{const pw=join(root,'password');writeFileSync(pw,password);try{tool('initdb',['-D',data,'-U','receipt_fixture','--pwfile='+pw,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{unlinkSync(pw);}
 const id=tool('pg_controldata',[data]).match(/Database system identifier:\s*(\d+)/)?.[1];if(!id)throw Error('No isolated identity');
 const port=await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
 tool('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 const r=spawnSync(process.execPath,['--import','./tests/register-server-only.mjs','--import','tsx','--test','tests/fulfilment-receipts-db.test.mts'],{env:{...env,METRO_RECEIPT_FIXTURE_URL:`postgresql://receipt_fixture:${password}@127.0.0.1:${port}/postgres`,METRO_RECEIPT_FIXTURE_ID:id},windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:3*1024*1024});
 const out=((r.stdout??'')+'\n'+(r.stderr??'')).replaceAll(password,'[REDACTED]').replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[CONNECTION REDACTED]');writeFileSync(join(root,'results.log'),out);console.log(out);if(r.status!==0)process.exitCode=1;
}finally{if(started)tool('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
