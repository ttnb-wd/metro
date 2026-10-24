import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '../src/server/db/generated/client.ts';
import {PrismaPg} from '@prisma/adapter-pg';
import {betterAuth} from 'better-auth';
import {createAuthOptions} from '../src/server/auth/options.ts';
import {profileNameInput,profileSessionError} from '../src/server/auth/profile.ts';

const raw=process.env.METRO_DISPOSABLE_APP_URL;
if(!raw)test('restricted auth requires owned disposable runner',{skip:true},()=>{});
else{
  const url=new URL(raw);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/metro_disposable_[a-f0-9]{16}$/);
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:raw}),log:[],errorFormat:'minimal'});
  after(()=>db.$disconnect());
  const origin='http://127.0.0.1:3998',email=`${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');
  let verificationToken='';
  const auth=betterAuth(createAuthOptions({enabled:true,nodeEnv:'test',databaseUrl:raw,origin,secret:randomBytes(48).toString('base64url')},db,
    async input=>{verificationToken=new URL(input.url).searchParams.get('token')!;}));
  async function request(path:string,body?:object,cookie?:string){
    return auth.handler(new Request(`${origin}/api/auth/${path}`,{method:body?'POST':'GET',headers:{origin,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  }
  test('Better Auth runs registration, verification, login, persistence, name-only update and logout under restricted PostgreSQL grants',async()=>{
    assert.equal((await request('sign-up/email',{email,password,name:'Release fixture'})).status,200);
    const initial=await db.user.findUniqueOrThrow({where:{email}});
    assert.equal(initial.emailVerified,false);
    assert.equal((await request('sign-in/email',{email,password})).status,403);
    assert.ok(verificationToken);
    assert.equal((await request(`verify-email?token=${encodeURIComponent(verificationToken)}`)).status,200);
    const login=await request('sign-in/email',{email,password});assert.equal(login.status,200);
    const cookie=login.headers.getSetCookie().map(header=>header.split(';')[0]).join('; ');
    for(let i=0;i<2;i++){const response=await request('get-session',undefined,cookie);assert.equal((await response.json()).user.id,initial.id);}
    const current=await (await request('get-session',undefined,cookie)).json();assert.equal(profileSessionError(current),null);
    const input=profileNameInput({name:'Admin'});assert.deepEqual(input,{name:'Admin'});
    const update=await request('update-user',input!,cookie);assert.equal(update.status,200);
    const updated=await db.user.findUniqueOrThrow({where:{email}});assert.equal(updated.name,'Admin');assert.equal(updated.id,initial.id);assert.equal(updated.email,initial.email);assert.equal(updated.emailVerified,true);
    assert.equal(await db.ownerBinding.count({where:{userId:initial.id}}),0);
    assert.equal((await (await request('get-session',undefined,cookie)).json()).user.name,'Admin');
    assert.equal((await request('sign-out',{},cookie)).status,200);assert.equal(await (await request('get-session',undefined,cookie)).json(),null);
    assert.equal((await request('update-user',{name:'Unauthorized'},cookie)).status,401);
  });
  test('runtime can read only migration readiness columns and cannot read migration logs or change history',async()=>{
    const rows=await db.$queryRaw<Array<{migration_name:string}>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(rows.length,4);
    await assert.rejects(db.$queryRaw`SELECT logs FROM _prisma_migrations`);
    await assert.rejects(db.$executeRaw`UPDATE _prisma_migrations SET finished_at=finished_at`);
  });
}
