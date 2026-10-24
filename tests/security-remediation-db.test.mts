import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID}from'node:crypto';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join,resolve,dirname,basename}from'node:path';
import sharp from'sharp';
import{betterAuth}from'better-auth';
import{PrismaClient}from'../src/server/db/generated/client.ts';
import{MetroPrismaPg}from'../src/server/db/prisma-pg.ts';
import{createPgPoolConfig}from'../src/server/db/connection-config.ts';
import{createAuthOptions,INTERNAL_AUTH_IP_HEADER}from'../src/server/auth/options.ts';
import{prepareAuthRequest}from'../src/server/auth/request-policy.ts';
import{buildRepositories}from'../src/server/website/repositories.ts';
import{buildPricingRepository,readPricing}from'../src/server/pricing/store.ts';
import{signCheckoutQuote,verifyCheckoutQuote}from'../src/server/commerce/quote.ts';
import{defaultDurations,calculateWebsiteQuote}from'../src/features/pricing/catalog.ts';
import{paymentMethods}from'../src/server/commerce/config.ts';
import{evidenceStore}from'../src/server/commerce/evidence-store.ts';
import{GET as evidenceGet}from'../src/app/api/evidence/[id]/route.ts';
import{POST as legacyUpload}from'../src/app/api/orders/[id]/evidence/route.ts';
import{POST as credentialPost}from'../src/app/api/services/[id]/credential/route.ts';
import{POST as commercePost}from'../src/app/api/commerce/route.ts';
import{consumeAuthBudget}from'../src/server/auth/rate-budget.ts';
import{buildFulfilmentWorker}from'../src/server/commerce/worker.ts';
type FixtureSession={user:{id:string;emailVerified:boolean};session:{id:string;userId:string;createdAt:Date;expiresAt:Date}};
test('security remediation adversarial checks against owned disposable PostgreSQL',async t=>{
 const urls=[process.env.METRO_DISPOSABLE_APP_URL!,process.env.METRO_DISPOSABLE_BOOTSTRAP_URL!,process.env.METRO_DISPOSABLE_WORKER_URL!];
 for(const raw of urls){const u=new URL(raw);assert.equal(u.hostname,'127.0.0.1');assert.match(u.pathname,/^\/metro_disposable_[a-f0-9]{16}$/);}
 const[app,admin,workerDb]=urls.map(raw=>new PrismaClient({adapter:new MetroPrismaPg(createPgPoolConfig(raw)),log:[],errorFormat:'minimal'}));
 const directory=await mkdtemp(join(tmpdir(),'metro-security-audit-'));
 Object.assign(process.env,{METRO_FULFILMENT_ENABLED:'true',METRO_VPN_EXECUTION_APPROVED:'true',METRO_VPN_SERVICE_ORIGIN:'https://no-network.example.invalid',METRO_VPN_SERVICE_KEY_ID:'isolated',METRO_VPN_SERVICE_SECRET:randomBytes(48).toString('hex'),METRO_EVIDENCE_PROVIDER:'local',METRO_EVIDENCE_DIRECTORY:directory,METRO_EVIDENCE_ENCRYPTION_KEY:randomBytes(32).toString('hex'),METRO_NOTIFICATIONS_ENABLED:'true'});
 const origin='https://metro-e2e.invalid',secret=randomBytes(48).toString('hex');
 let session:FixtureSession|null=null;
 const repository=()=>buildRepositories(app,async()=>session);
 const context={app,session,secret,repositories:repository,invalidated:new Set<string>(),headers:new Headers({origin})};
 (globalThis as unknown as {metroCommerceE2e:typeof context}).metroCommerceE2e=context;
 function actor(value:FixtureSession|null){session=value;context.session=value;}
 const meta=()=>({requestId:randomUUID(),idempotencyKey:randomUUID()});
 try{
  const environment={enabled:true as const,nodeEnv:'test' as const,databaseUrl:urls[0],origin,secret};
  let ownerFixtureId='';
  const email=`${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');let verificationToken='';
  let resetToken='';
  const auth=betterAuth(createAuthOptions(environment,app,async({url})=>{verificationToken=new URL(url).searchParams.get('token')!;},async input=>{resetToken=input.token;}));
  const prepared=(path:string,body:object,ip='203.0.113.10')=>prepareAuthRequest(new Request(origin+'/api/auth/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':ip,'x-real-ip':ip},body:JSON.stringify(body)}),environment);

  await t.test('registration cannot set emailVerified, choose identity or acquire OWNER; verification/login/logout persist',async()=>{
   const r=await auth.handler(await prepared('sign-up/email',{email,password,name:'Audit fixture',emailVerified:true,role:'OWNER',id:randomUUID()}));assert.equal(r.status,200);
   const u=await admin.user.findUniqueOrThrow({where:{email}});assert.equal(u.emailVerified,false);assert.equal(await admin.ownerBinding.count({where:{userId:u.id}}),0);
   assert.equal((await auth.handler(await prepared('sign-in/email',{email,password}))).status,403);
   assert.ok(verificationToken);assert.equal((await auth.handler(new Request(origin+'/api/auth/verify-email?token='+encodeURIComponent(verificationToken)))).status,200);
   assert.equal((await auth.handler(await prepared('sign-in/email',{email,password:'deliberately-wrong-audit-password'}))).status,401);
   const login=await auth.handler(await prepared('sign-in/email',{email,password}));assert.equal(login.status,200);
   const cookie=login.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ');
   for(let i=0;i<2;i++){const value=await(await auth.handler(new Request(origin+'/api/auth/get-session',{headers:{cookie}}))).json();assert.equal(value.user.id,u.id);}
   assert.equal((await auth.handler(await prepared('sign-up/email',{email,password,name:'Duplicate audit'}))).status,200);assert.equal(await admin.user.count({where:{email}}),1);
   const logoutRequest=await prepared('sign-out',{});logoutRequest.headers.set('cookie',cookie);assert.equal((await auth.handler(logoutRequest)).status,200);
   assert.equal(await(await auth.handler(new Request(origin+'/api/auth/get-session',{headers:{cookie}}))).json(),null);
   const verifiedBefore=await admin.user.findUniqueOrThrow({where:{id:u.id}});assert.equal(verifiedBefore.emailVerified,true);
   const replay=await auth.handler(new Request(origin+'/api/auth/verify-email?token='+encodeURIComponent(verificationToken)));assert.equal(replay.status,200);assert.equal(await admin.session.count({where:{userId:u.id}}),0);
  });
  await t.test('password reset is single-use under concurrency, expires and atomically revokes sessions using restricted runtime',async()=>{
   await admin.rateLimit.deleteMany();
   const before=await admin.user.findUniqueOrThrow({where:{email}}),login=await auth.handler(await prepared('sign-in/email',{email,password}));assert.equal(login.status,200);
   const cookie=login.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ');
   assert.equal((await auth.handler(await prepared('request-password-reset',{email,redirectTo:'/reset-password'}))).status,200);assert.ok(resetToken);
   await admin.verification.updateMany({where:{identifier:'reset-password:'+resetToken},data:{expiresAt:new Date(Date.now()-1000)}});
   const newPassword=randomBytes(32).toString('base64url');
   assert.equal((await auth.handler(await prepared('reset-password',{token:resetToken,newPassword}))).status,400);
   await admin.rateLimit.deleteMany();
   assert.equal((await auth.handler(await prepared('request-password-reset',{email,redirectTo:'/reset-password'}))).status,200);
   const token=resetToken;
   const results=await Promise.all([auth.handler(await prepared('reset-password',{token,newPassword})),auth.handler(await prepared('reset-password',{token,newPassword}))]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
   assert.equal(await admin.session.count({where:{userId:before.id}}),0);
   assert.equal(await(await auth.handler(new Request(origin+'/api/auth/get-session',{headers:{cookie}}))).json(),null);
   const after=await admin.user.findUniqueOrThrow({where:{id:before.id}});assert.equal(after.emailVerified,true);assert.equal(after.id,before.id);assert.equal(after.email,before.email);
   await admin.rateLimit.deleteMany();
   assert.equal((await auth.handler(await prepared('sign-in/email',{email,password}))).status,401);
   assert.equal((await auth.handler(await prepared('sign-in/email',{email,password:newPassword}))).status,200);
   assert.equal((await auth.handler(await prepared('reset-password',{token,newPassword:password}))).status,400);
   await admin.rateLimit.deleteMany();
  });
  await t.test('failed logins cannot lock an unrelated verified OWNER; spoofed IPs cannot reset the account budget',async()=>{
   const secondEmail=randomUUID()+'@example.invalid';assert.equal((await auth.handler(await prepared('sign-up/email',{email:secondEmail,password,name:'Independent fixture'}))).status,200);assert.equal((await auth.handler(new Request(origin+'/api/auth/verify-email?token='+encodeURIComponent(verificationToken)))).status,200);ownerFixtureId=(await admin.user.findUniqueOrThrow({where:{email:secondEmail}})).id;await admin.ownerBinding.create({data:{slot:1,userId:ownerFixtureId}});await admin.rateLimit.deleteMany();
   const a=await prepared('sign-in/email',{email,password:'deliberately-wrong-audit-password'}),same=await prepared('sign-in/email',{email,password},'198.51.100.100'),b=await prepared('sign-in/email',{email:secondEmail,password},'198.51.100.100');assert.equal(a.headers.get(INTERNAL_AUTH_IP_HEADER),same.headers.get(INTERNAL_AUTH_IP_HEADER));assert.notEqual(a.headers.get(INTERNAL_AUTH_IP_HEADER),b.headers.get(INTERNAL_AUTH_IP_HEADER));
   for(let i=0;i<5;i++){const request=await prepared('sign-in/email',{email,password:'deliberately-wrong-audit-password'},'203.0.113.'+(10+i));await consumeAuthBudget(app,request);await auth.handler(request);}
   await assert.rejects(consumeAuthBudget(app,same),{status:429});await consumeAuthBudget(app,b);assert.equal((await auth.handler(b)).status,200);
   const requests=Array.from({length:12},()=>prepared('sign-up/email',{email:'atomic-'+secondEmail,password,name:'No write'}).then(r=>consumeAuthBudget(app,r)));const limits=await Promise.allSettled(requests);assert.equal(limits.filter(x=>x.status==='fulfilled').length,3);assert.equal(limits.filter(x=>x.status==='rejected').length,9);
  });
  await t.test('rotating verification tokens cannot bypass the verified Vercel source budget',async()=>{const platform={...environment,platform:'vercel' as const};const checks=Array.from({length:75},async()=>{const request=await prepareAuthRequest(new Request(origin+'/api/auth/verify-email',{method:'POST',headers:{origin,'content-type':'application/json','x-real-ip':'203.0.113.80'},body:JSON.stringify({token:randomUUID()})}),platform);return consumeAuthBudget(app,request);});const results=await Promise.allSettled(checks);assert.equal(results.filter(r=>r.status==='fulfilled').length,60);assert.equal(results.filter(r=>r.status==='rejected').length,15);});
  const sessions:FixtureSession[]=[];
  for(let i=0;i<4;i++){const id=i===0?ownerFixtureId:randomUUID();if(i!==0)await admin.user.create({data:{id,name:'Audit fixture',email:`${id}@example.invalid`,emailVerified:i!==3}});const s=await admin.session.create({data:{userId:id,token:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});sessions.push({user:{id,emailVerified:i!==3},session:s});}
  assert.equal((await admin.ownerBinding.findUniqueOrThrow({where:{slot:1}})).userId,sessions[0].user.id);actor(sessions[0]);
  const pricing=buildPricingRepository(app,async()=>session),packageId=randomUUID();await pricing.publish({expectedVersion:0,requestKey:randomUUID(),catalog:{policy:'metro-website-pricing.v1',packages:[{id:packageId,name:'Audit fixture',dataGb:10,monthlyPriceMmk:'7500',active:true}],durations:defaultDurations()}});
  const pricingState=await readPricing(app);if(pricingState.status!=='READY')throw Error('Disposable pricing missing');
  actor(sessions[1]);const signed=signCheckoutQuote(pricingState.release,{version:1,packageId,months:1},session.user.id,paymentMethods({})[0],secret);
  await t.test('7500-to-1 MMK modification, extra discount and cross-user quote replay fail',async()=>{
   assert.equal(signed.quote.totalMmk,'7500');assert.throws(()=>calculateWebsiteQuote(pricingState.release,{version:1,packageId,months:1,totalMmk:'1',discountPercent:100}));
   const parts=signed.token.split('.');const changed=JSON.parse(Buffer.from(parts[0],'base64url').toString());changed.totalMmk='1';assert.throws(()=>verifyCheckoutQuote(Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+parts[1],session.user.id,secret));assert.throws(()=>verifyCheckoutQuote(signed.token,sessions[2].user.id,secret));
  });
  const order=(await repository().createWebsiteOrder(verifyCheckoutQuote(signed.token,session.user.id,secret),meta())).id;
  const bytes=await sharp({create:{width:24,height:24,channels:3,background:'#123456'}}).png().toBuffer();const proof=await evidenceStore().put(bytes,'image/png');await repository().submitDraftPayment(order,proof,meta());
  const row=await repository().checkoutReceipt(order);assert.ok(row);
  const readEvidence=()=>evidenceGet(new Request(origin+'/api/evidence/'+row.id+'?view=1'),{params:Promise.resolve({id:row.id})});
  await t.test('Customer B order/proof/key IDOR and forged OWNER credential access fail closed',async()=>{
   const externalId=randomUUID();const ent={id:externalId,owner:{issuer:'metro-website',subject:sessions[1].user.id},packageId,version:0,status:'ACTIVE',keyId:'audit-finite-key',keyStatus:'ENFORCED',expiresAt:new Date(Date.now()+30*86400000).toISOString(),totalBytes:signed.quote.quotaBytes,usedBytes:'0',remainingBytes:signed.quote.quotaBytes,usageHistoryVersion:0,observedAt:new Date().toISOString()};
   const service=await admin.websiteServiceReference.create({data:{userId:sessions[1].user.id,externalId,snapshot:ent,version:0}});
   const keyRequest=(body:object)=>credentialPost(new Request(origin+'/api/services/'+service.id+'/credential',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:service.id})});
   actor(sessions[2]);await assert.rejects(repository().order(order),{code:'NOT_FOUND'});assert.equal((await readEvidence()).status,404);assert.equal((await keyRequest({})).status,404);assert.equal((await keyRequest({admin:true})).status,403);
   actor(sessions[1]);assert.equal((await keyRequest({quotaBytes:'999999',expiresAt:'2099-01-01T00:00:00.000Z'})).status,400);
   actor(sessions[3]);assert.equal((await keyRequest({})).status,401);actor(sessions[1]);
  });
  await t.test('approved evidence policy: CUSTOMER previews only their own proof',async()=>{actor(sessions[1]);assert.equal((await readEvidence()).status,200);});
  await t.test('OWNER proof reads enforce persisted five-minute recent authentication',async()=>{actor(sessions[0]);assert.equal((await readEvidence()).status,200);await admin.session.update({where:{id:session.session.id},data:{createdAt:new Date(Date.now()-301000)}});assert.equal((await readEvidence()).status,403);await admin.session.update({where:{id:session.session.id},data:{createdAt:new Date(Date.now()-1000)}});});
  await t.test('alternate route rejects any new proof while already UNDER_REVIEW',async()=>{
   actor(sessions[1]);const other=await sharp({create:{width:24,height:24,channels:3,background:'#abcdef'}}).png().toBuffer();const form=new FormData();form.set('requestKey',randomUUID());form.set('proof',new File([other],'audit.png',{type:'image/png'}));const response=await legacyUpload(new Request(origin+'/api/orders/'+order+'/evidence',{method:'POST',headers:{origin},body:form}),{params:Promise.resolve({id:order})});assert.equal(response.status,409);assert.equal(await admin.paymentEvidence.count({where:{orderId:order}}),1);const original=await admin.paymentEvidence.findUniqueOrThrow({where:{id:row.id}});assert.equal(original.sha256,proof.sha256);
  });
  await t.test('unverified fulfilment attempts and forged approved-payment fields cannot enqueue any operation',async()=>{
   const request=()=>new Request(origin+'/api/commerce',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'approve',orderId:order,payment:'CONFIRMED',provisioning:'SUCCEEDED',amountMmk:'1'})});
   actor(sessions[3]);assert.equal((await commercePost(request())).status,401);
   await assert.rejects(repository().decidePayment({userId:sessions[1].user.id,orderId:order,evidenceId:row.id,reviewedVersion:1,reviewedSha256:row.sha256,verificationRef:randomUUID(),amountMmk:'7500',decision:'APPROVED'},meta()),{code:'FORBIDDEN'});
   actor(sessions[1]);assert.equal((await commercePost(request())).status,400);assert.equal(await admin.paymentDecision.count(),0);assert.equal(await admin.websiteOperation.count(),0);
  });
  await t.test('OWNER decision is bound to the reviewed evidence hash and order version',async()=>{actor(sessions[0]);const input={userId:sessions[1].user.id,orderId:order,evidenceId:row.id,reviewedVersion:1,reviewedSha256:row.sha256,verificationRef:randomUUID(),amountMmk:'7500',decision:'APPROVED'};await assert.rejects(repository().decidePayment({...input,reviewedVersion:0},meta()),{code:'CONFLICT'});await assert.rejects(repository().decidePayment({...input,reviewedSha256:'0'.repeat(64)},meta()),{code:'CONFLICT'});assert.equal(await admin.paymentDecision.count(),0);});
  await t.test('storage reservations enforce order ownership and lifetime attempt budgets before any provider call',async()=>{actor(sessions[1]);await assert.rejects(repository().reserveEvidenceUpload(order),{code:'CONFLICT'});const q=signCheckoutQuote(pricingState.release,{version:1,packageId,months:1},sessions[1].user.id,paymentMethods({})[0],secret);const draft=(await repository().createWebsiteOrder(verifyCheckoutQuote(q.token,sessions[1].user.id,secret),meta())).id;actor(sessions[2]);await assert.rejects(repository().reserveEvidenceUpload(draft),{code:'NOT_FOUND'});actor(sessions[1]);for(let i=0;i<10;i++)await repository().reserveEvidenceUpload(draft);await assert.rejects(repository().reserveEvidenceUpload(draft),{code:'CONFLICT'});assert.equal(await admin.paymentEvidence.count({where:{orderId:draft}}),0);});
  await t.test('CUSTOMER cannot approve payment; concurrent OWNER approvals produce one outbox operation',async()=>{
   const data={userId:sessions[1].user.id,orderId:order,evidenceId:row.id,reviewedVersion:1,reviewedSha256:row.sha256,verificationRef:randomUUID(),amountMmk:'7500',decision:'APPROVED'};actor(sessions[1]);await assert.rejects(repository().decidePayment(data,meta()),{code:'FORBIDDEN'});actor(sessions[0]);const parallel=await Promise.allSettled([repository().decidePayment(data,meta()),repository().decidePayment({...data,verificationRef:randomUUID()},meta())]);assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(parallel.filter(r=>r.status==='rejected').length,1);assert.equal(await admin.paymentDecision.count({where:{orderId:order}}),1);assert.equal(await admin.websiteOperation.count({where:{orderId:order}}),1);
  });
  await t.test('worker rejects incomplete and contradictory backend results; payment and durable operation survive',async()=>{
   const total=(BigInt(signed.quote.quotaBytes)*2n).toString(),response={id:randomUUID(),owner:{issuer:'metro-website',subject:sessions[1].user.id},packageId,version:0,status:'ACTIVE',keyId:'audit-mock-key-only',keyStatus:'ENFORCED',expiresAt:new Date(Date.now()+86400000).toISOString(),totalBytes:total,usedBytes:'0',remainingBytes:total,usageHistoryVersion:0,observedAt:new Date().toISOString()};
   const before=await admin.websiteServiceReference.findMany({orderBy:{id:'asc'},select:{id:true,version:true,snapshot:true}});
   const worker=buildFulfilmentWorker(workerDb,async()=>response,true);assert.equal((await worker.runOne()).status,'REVIEW_REQUIRED');assert.deepEqual(await admin.websiteServiceReference.findMany({orderBy:{id:'asc'},select:{id:true,version:true,snapshot:true}}),before);assert.equal((await admin.websiteOrder.findUniqueOrThrow({where:{id:order}})).state,'REVIEW_REQUIRED');assert.equal((await admin.websiteOrder.findUniqueOrThrow({where:{id:order}})).payment,'CONFIRMED');
  });
 }finally{await app.$disconnect();await admin.$disconnect();await workerDb.$disconnect();if(dirname(resolve(directory))===resolve(tmpdir())&&basename(directory).startsWith('metro-security-audit-'))await rm(directory,{recursive:true,force:true});}
});
