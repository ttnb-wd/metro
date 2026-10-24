import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/server/db/generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildAdminRepository } from "../src/server/admin/repository.ts";
import { buildPricingRepository, readPricing } from "../src/server/pricing/store.ts";
import { buildRepositories } from "../src/server/website/repositories.ts";
import { defaultDurations, PRICING_POLICY, calculateWebsiteQuote } from "../src/features/pricing/catalog.ts";
import { FoundationError } from "../src/server/owner/authorization.ts";
import { priceQuote } from "../src/server/vpn/policy.ts";
import { allowQuoteRequest } from "../src/server/pricing/http.ts";
import type { EnabledAuthEnvironment } from "../src/server/env.ts";

const appUrl=process.env.METRO_DISPOSABLE_APP_URL,bootstrapUrl=process.env.METRO_DISPOSABLE_BOOTSTRAP_URL;
if(!appUrl||!bootstrapUrl)throw new Error("Use the verified isolated admin-pricing runner.");
for(const raw of [appUrl,bootstrapUrl]){const url=new URL(raw);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/metro_disposable_[a-f0-9]{16}$/);}
const admin=new PrismaClient({adapter:new PrismaPg({connectionString:bootstrapUrl,max:5}),log:[],errorFormat:"minimal"});
const app=new PrismaClient({adapter:new PrismaPg({connectionString:appUrl,max:8}),log:[],errorFormat:"minimal"});
after(async()=>{await app.$disconnect();await admin.$disconnect();});
const owner=randomUUID(),customer=randomUUID();
for(const id of [owner,customer])await admin.user.create({data:{id,name:"Isolated test",email:`${id}@example.invalid`,emailVerified:true}});
async function makeSession(userId:string,age=1000){return admin.session.create({data:{userId,token:randomUUID(),createdAt:new Date(Date.now()-age),expiresAt:new Date(Date.now()+3600000)}});}
const fresh=await makeSession(owner),cust=await makeSession(customer),old=await makeSession(owner,301000);
// Claim a fresh timestamp deliberately: authorization must still use persisted freshness.
const reader=(row:typeof fresh)=>async()=>({user:{id:row.userId,emailVerified:true},session:{id:row.id,userId:row.userId,createdAt:new Date(Date.now()-1000),expiresAt:row.expiresAt}});
const ownerRepo=buildAdminRepository(app,reader(fresh)),customerRepo=buildAdminRepository(app,reader(cust));
const pricing=buildPricingRepository(app,reader(fresh)),customerPricing=buildPricingRepository(app,reader(cust));
const stalePricing=buildPricingRepository(app,reader(old));
const catalog={policy:PRICING_POLICY,packages:[{id:randomUUID(),name:"Website test only",dataGb:50,monthlyPriceMmk:"10000",active:true}],durations:defaultDurations()};
const input=(expectedVersion:number)=>({expectedVersion,requestKey:randomUUID(),catalog:structuredClone(catalog)});
const isCode=(code:string)=>(error:unknown)=>error instanceof FoundationError&&error.code===code;

test("unassigned users are denied across admin read and write repositories",async()=>{
  await assert.rejects(ownerRepo.identity(),isCode("FORBIDDEN"));
  await assert.rejects(pricing.publish(input(0)),isCode("FORBIDDEN"));
  await admin.ownerBinding.create({data:{slot:1,userId:owner}});
});
test("CUSTOMER cannot read any admin section or publish pricing",async()=>{
  for(const section of ["customers","orders","payments","vpn","support","notifications","audit"] as const)await assert.rejects(customerRepo.records(section,{}),isCode("FORBIDDEN"));
  await assert.rejects(customerRepo.customer(owner),isCode("FORBIDDEN"));
  await assert.rejects(customerRepo.overview(),isCode("FORBIDDEN"));
  await assert.rejects(customerPricing.readForOwner(),isCode("FORBIDDEN"));
  await assert.rejects(customerPricing.publish(input(0)),isCode("FORBIDDEN"));
});
test("actual verified identity and persisted session freshness fail closed",async()=>{
  await assert.rejects(stalePricing.publish(input(0)),isCode("RECENT_AUTH_REQUIRED"));
  assert.equal((await buildAdminRepository(app,reader(old)).identity()).id,owner);
  const unverified=buildAdminRepository(app,async()=>({...await reader(fresh)(),user:{id:owner,emailVerified:false}}));
  await assert.rejects(unverified.identity(),isCode("UNAUTHENTICATED"));
  const gone=await makeSession(owner);await admin.session.delete({where:{id:gone.id}});
  await assert.rejects(buildAdminRepository(app,reader(gone)).identity(),isCode("UNAUTHENTICATED"));
});
test("runtime keeps append-only pricing and immutable OWNER permissions",async()=>{
  const [p]=await app.$queryRaw<Array<{unsafe:boolean}>>`SELECT (has_table_privilege(current_user,'metro_pricing_release','UPDATE,DELETE,TRUNCATE') OR has_schema_privilege(current_user,'public','CREATE') OR has_table_privilege(current_user,'metro_owner_binding','INSERT,UPDATE,DELETE,TRUNCATE')) AS unsafe`;
  assert.equal(p.unsafe,false);
  await assert.rejects(app.websitePricingRelease.create({data:{version:1,catalog,createdById:customer,requestKey:randomUUID(),payloadDigest:"a".repeat(64)}}));
});
test("first publication is durable and atomically audited",async()=>{
  assert.equal((await readPricing(app)).status,"UNPUBLISHED");
  const result=await pricing.publish(input(0));assert.equal(result.version,1);
  const state=await readPricing(app);assert.equal(state.status,"READY");
  assert.equal(await admin.websiteAuditEvent.count({where:{action:"PRICING_PUBLISHED",resourceId:result.id}}),1);
});
test("simultaneous duplicate saves return one receipt and one audit event",async()=>{
  const data=input(1);const receipts=await Promise.all(Array.from({length:5},()=>pricing.publish(data)));
  assert.equal(new Set(receipts.map(result=>result.id)).size,1);
  assert.equal(await admin.websitePricingRelease.count({where:{requestKey:data.requestKey}}),1);
  assert.equal(await admin.websiteAuditEvent.count({where:{action:"PRICING_PUBLISHED",idempotencyKey:data.requestKey}}),1);
  const changed=structuredClone(data);changed.catalog.packages[0].monthlyPriceMmk="9999";
  await assert.rejects(pricing.publish(changed),isCode("CONFLICT"));
});
test("two editors cannot overwrite each other and stale quotes are rejected",async()=>{
  const a=input(2),b=input(2);a.catalog.packages[0].monthlyPriceMmk="15000";b.catalog.packages[0].monthlyPriceMmk="20000";
  const result=await Promise.allSettled([pricing.publish(a),pricing.publish(b)]);
  assert.equal(result.filter(value=>value.status==="fulfilled").length,1);
  assert.equal(result.filter(value=>value.status==="rejected").length,1);
  const state=await readPricing(app);assert.equal(state.status,"READY");
  if(state.status==="READY")assert.throws(()=>calculateWebsiteQuote(state.release,{version:2,packageId:catalog.packages[0].id,months:1}),/PRICING_CHANGED/);
});
test("audit insertion failure rolls pricing back with no partial version",async()=>{
  const before=await admin.websitePricingRelease.count();
  await admin.$executeRawUnsafe('REVOKE INSERT ON metro_owner_audit FROM metro_disposable_app');
  try{await assert.rejects(pricing.publish(input(3)),isCode("UNAVAILABLE"));}
  finally{await admin.$executeRawUnsafe('GRANT INSERT ON metro_owner_audit TO metro_disposable_app');}
  assert.equal(await admin.websitePricingRelease.count(),before);
});
test("order snapshots survive pricing changes and rejection never queues provisioning",async()=>{
  const repositories=buildRepositories(app,reader(cust));
  const quote=priceQuote({id:randomUUID(),owner:{issuer:"metro-website",subject:customer},pkg:{id:"legacy-fixture",name:"Historical fixture",monthlyPriceMmk:"5000",monthlyQuotaBytes:"1000",baseDurationDays:30},catalogVersion:"historical-fixture-v1",months:2,validUntil:new Date(Date.now()+600000).toISOString()});
  const meta=()=>({requestId:randomUUID(),idempotencyKey:randomUUID()});
  const order=await repositories.createOrder(quote,meta());
  const evidence=await repositories.addEvidence({orderId:order.id,storageRef:randomUUID(),sha256:"a".repeat(64),mediaType:"image/png",bytes:42},meta());
  await pricing.publish(input(3));
  const preserved=await admin.websiteOrder.findUniqueOrThrow({where:{id:order.id}});
  assert.equal(preserved.totalMmk.toFixed(0),quote.totalMmk);assert.deepEqual(preserved.quoteSnapshot,quote);
  const target=await ownerRepo.paymentRejectionTarget(evidence.id);const key=randomUUID();
  const decisions=buildRepositories(app,reader(fresh));
  const args={...target,decision:"REJECTED",verificationRef:key};
  await decisions.decidePayment(args,{requestId:key,idempotencyKey:key});
  await decisions.decidePayment(args,{requestId:key,idempotencyKey:key});
  assert.equal(await admin.paymentDecision.count({where:{orderId:order.id}}),1);
  assert.equal(await admin.websiteOperation.count({where:{orderId:order.id}}),0);
  assert.equal((await admin.websiteOrder.findUniqueOrThrow({where:{id:order.id}})).payment,"REJECTED");
});
test("version history is immutable even for the migration owner and ordinary DTOs exclude secrets",async()=>{
  const row=await admin.websitePricingRelease.findFirstOrThrow();
  await assert.rejects(admin.websitePricingRelease.update({where:{id:row.id},data:{version:99}}));
  await assert.rejects(admin.websitePricingRelease.delete({where:{id:row.id}}));
  for(const section of ["customers","orders","payments","vpn","support","notifications","audit"] as const){
    const result=await ownerRepo.records(section,{});const text=JSON.stringify(result);
    assert.doesNotMatch(text,/ss:\/\/|storageRef|payloadDigest|password|sessionToken|leaseId/);
  }
});
test("quotes use a database-backed rate limit in a separate namespace",async()=>{
  const request=new Request("http://127.0.0.1:3000/api/pricing/quote");
  const env={enabled:true} as EnabledAuthEnvironment;
  assert.equal(await allowQuoteRequest(app,request,env),true);
  await admin.rateLimit.updateMany({where:{key:{startsWith:"website-quote:"}},data:{count:600}});
  assert.equal(await allowQuoteRequest(app,request,env),false);
});
