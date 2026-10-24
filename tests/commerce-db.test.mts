import {fixtureReceipt} from './fulfilment-fixture.mts';
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Client, Pool } from "pg";
import { PrismaClient } from "../src/server/db/generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildRepositories } from "../src/server/website/repositories.ts";
import { buildPricingRepository, readPricing } from "../src/server/pricing/store.ts";
import { buildFulfilmentWorker } from "../src/server/commerce/worker.ts";
import { signCheckoutQuote, verifyCheckoutQuote } from "../src/server/commerce/quote.ts";
import { paymentMethods } from "../src/server/commerce/config.ts";

const appUrl=process.env.METRO_DISPOSABLE_APP_URL!,adminUrl=process.env.METRO_DISPOSABLE_BOOTSTRAP_URL!;
for(const raw of [appUrl,adminUrl,process.env.METRO_DISPOSABLE_WORKER_URL!]){const u=new URL(raw);if(u.hostname!=="127.0.0.1"||!/^\/metro_disposable_[a-f0-9]{16}$/.test(u.pathname))throw new Error("Verified disposable runner required.");}
const workerDb=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.METRO_DISPOSABLE_WORKER_URL!,max:4}),log:[]});
const admin=new PrismaClient({adapter:new PrismaPg({connectionString:adminUrl,max:5}),log:[]}),app=new PrismaClient({adapter:new PrismaPg({connectionString:appUrl,max:8}),log:[]});
const binding=await admin.ownerBinding.findUniqueOrThrow({where:{slot:1}}),customer=randomUUID(),stranger=randomUUID();
for(const id of [customer,stranger])await admin.user.create({data:{id,name:"Commerce fixture",email:`${id}@example.invalid`,emailVerified:true}});
async function reader(userId:string){const row=await admin.session.create({data:{userId,token:randomUUID(),createdAt:new Date(Date.now()-1000),expiresAt:new Date(Date.now()+3600000)}});return async()=>({user:{id:userId,emailVerified:true},session:row});}
const customerReader=await reader(customer),ownerReader=await reader(binding.userId),otherReader=await reader(stranger);
const repo=buildRepositories(app,customerReader),ownerRepo=buildRepositories(app,ownerReader),otherRepo=buildRepositories(app,otherReader),pricing=buildPricingRepository(app,ownerReader),secret=randomBytes(32).toString("hex");
const meta=()=>({requestId:randomUUID(),idempotencyKey:randomUUID()});
let orderId:string,evidenceId:string,snapshot:object;

test("signed server quote creates one order; ownership and stale prices fail closed",async()=>{
  const current=await readPricing(app);if(current.status!=="READY")throw Error("Pricing fixture missing");
  const selected={version:current.release.version,packageId:current.release.catalog.packages[0].id,months:2};
  const signed=signCheckoutQuote(current.release,selected,customer,paymentMethods({})[0],secret),quote=verifyCheckoutQuote(signed.token,customer,secret),metadata=meta();
  const results=await Promise.all([repo.createWebsiteOrder(quote,metadata),repo.createWebsiteOrder(quote,metadata)]);assert.equal(results[0].id,results[1].id);orderId=results[0].id;
  await assert.rejects(otherRepo.createWebsiteOrder(quote,meta()));await assert.rejects(otherRepo.order(orderId));
  snapshot=(await admin.websiteOrder.findUniqueOrThrow({where:{id:orderId}})).quoteSnapshot as object;
  const pending=signCheckoutQuote(current.release,selected,customer,paymentMethods({})[0],secret),catalog=structuredClone(current.release.catalog);catalog.durations[1].discountPercent=23;
  await pricing.publish({expectedVersion:current.release.version,requestKey:randomUUID(),catalog});
  await assert.rejects(repo.createWebsiteOrder(verifyCheckoutQuote(pending.token,customer,secret),meta()));
  assert.deepEqual((await admin.websiteOrder.findUniqueOrThrow({where:{id:orderId}})).quoteSnapshot,snapshot);
});
test("private evidence ownership and atomic duplicate payment approval",async()=>{
  const metadata=meta(),proof={orderId,storageRef:randomUUID(),sha256:"a".repeat(64),mediaType:"image/png",bytes:100};
  evidenceId=(await repo.addEvidence(proof,metadata)).id;assert.equal((await repo.addEvidence(proof,metadata)).id,evidenceId);
  await assert.rejects(otherRepo.evidenceFile(evidenceId));await assert.rejects(otherRepo.listEvidence(orderId));
  const row=await repo.order(orderId),decision={userId:customer,orderId,evidenceId,reviewedVersion:1,reviewedSha256:"a".repeat(64),verificationRef:randomUUID(),amountMmk:row.totalMmk.toFixed(0),decision:"APPROVED"};
  await assert.rejects(repo.decidePayment(decision,meta()));const key=meta();await Promise.all([ownerRepo.decidePayment(decision,key),ownerRepo.decidePayment(decision,key)]);
  assert.equal(await admin.paymentDecision.count({where:{orderId,decision:"APPROVED"}}),1);assert.equal(await admin.websiteOperation.count({where:{orderId}}),1);assert.equal(await admin.websiteOutboxEvent.count({where:{businessKey:`fulfil:${orderId}`}}),1);
});
test("checkout waiting on a publisher cannot accept its previous pricing snapshot",async()=>{
  const current=await readPricing(app);if(current.status!=="READY")throw Error();
  const signed=signCheckoutQuote(current.release,{version:current.release.version,packageId:current.release.catalog.packages[0].id,months:1},customer,paymentMethods({})[0],secret),quote=verifyCheckoutQuote(signed.token,customer,secret);
  let attempt:Promise<string>|undefined;
  await admin.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('metro:website-pricing',0))::text`;
    attempt=repo.createWebsiteOrder(quote,meta()).then(()=>"ACCEPTED",error=>error.code);
    let waiting=false;
    for(let index=0;index<30;index++){
      const [state]=await tx.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND pid<>pg_backend_pid()) AS waiting`;
      if(state.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true);
    const catalog=structuredClone(current.release.catalog);catalog.packages[0].monthlyPriceMmk=(BigInt(catalog.packages[0].monthlyPriceMmk)+1n).toString();
    const requestKey=randomUUID(),release=await tx.websitePricingRelease.create({data:{version:current.release.version+1,catalog,createdById:binding.userId,requestKey,payloadDigest:"b".repeat(64)}});
    await tx.websiteAuditEvent.create({data:{actorId:binding.userId,targetUserId:binding.userId,action:"PRICING_PUBLISHED",outcome:"SUCCESS",resourceId:release.id,reasonCode:"OWNER_WEBSITE_PRICING",requestId:randomUUID(),idempotencyKey:requestKey}});
  });
  assert.equal(await attempt,"CONFLICT");assert.equal(await admin.websiteOrder.count({where:{quoteId:quote.id}}),0);
});
test("worker retries same operation without losing payment or duplicating service",async()=>{
  const operation=await admin.websiteOperation.findFirstOrThrow({where:{orderId}});let calls=0;const entitlementId=randomUUID(),keyId="mw-"+randomBytes(24).toString("hex"),frozen=operation.frozenSnapshot as Record<string,string>;
  const transport=async(_action:string,input:object)=>{calls++;assert.equal((input as {operationId:string}).operationId,operation.id);if(calls===1)throw Error("isolated failure");return fixtureReceipt(input,{id:entitlementId,owner:{issuer:"metro-website",subject:customer},packageId:frozen.packageId,version:0,status:"ACTIVE",keyId,keyStatus:"ENFORCED",expiresAt:new Date(Date.now()+60*86400000).toISOString(),totalBytes:frozen.quotaBytes,usedBytes:"0",remainingBytes:frozen.quotaBytes,usageHistoryVersion:0,observedAt:new Date().toISOString()});};
  await assert.rejects(workerDb.user.count());await assert.rejects(workerDb.ownerBinding.findMany());
  const worker=buildFulfilmentWorker(workerDb,transport,true);assert.equal((await worker.runOne()).status,"RETRY_PENDING");assert.equal((await repo.order(orderId)).payment,"CONFIRMED");
  await assert.rejects(workerDb.websiteOrder.update({where:{id:orderId},data:{payment:"CONFIRMED"}}));
  await admin.websiteOutboxEvent.updateMany({where:{operationId:operation.id},data:{availableAt:new Date(Date.now()-1000)}});
  assert.equal((await worker.runOne()).status,"DELIVERED");assert.equal((await worker.runOne()).status,"IDLE");
  const order=await repo.order(orderId);assert.equal(order.state,"COMPLETE");assert.deepEqual(order.quoteSnapshot,snapshot);assert.equal((await repo.listServices()).length,1);assert.equal((await otherRepo.listServices()).length,0);
});
test("support issue, OWNER test and three guided retries persist with notification",async()=>{
  const service=(await repo.listServices())[0],issue=(await repo.reportIssue({serviceId:service.id,category:"CANNOT_CONNECT",description:"Isolated connection report"},meta())).id;
  await assert.rejects(otherRepo.reportIssue({serviceId:service.id,category:"CANNOT_CONNECT",description:"Cannot claim another service"},meta()));
  await ownerRepo.recordDiagnosis({userId:customer,issueId:issue,version:0,result:"SUCCEEDED"},meta());
  for(let attempt=0;attempt<3;attempt++)await repo.recordRetry({issueId:issue,version:attempt+1,expectedAttempt:attempt,result:"FAILED"},meta());
  const state=await admin.supportIssue.findUniqueOrThrow({where:{id:issue}});assert.equal(state.state,"REVIEW_REQUIRED");assert.equal(state.attempts,3);assert.equal(await admin.websiteOutboxEvent.count({where:{businessKey:`issue:${issue}`}}),1);
});
test("separate disposable backend migration and durable fixed-ID engine",async()=>{
  const control=new Client({connectionString:adminUrl});await control.connect();const name=new URL(adminUrl).pathname.slice(1)+"_vpn";await control.query(`CREATE DATABASE "${name}"`);await control.end();
  const url=new URL(adminUrl);url.pathname="/"+name;const client=new Client({connectionString:url.toString()});await client.connect();
  const backendPassword=randomBytes(32).toString("hex"),serviceUrl=new URL(url);serviceUrl.username="metro_website_service";serviceUrl.password=backendPassword;
  const pool=new Pool({connectionString:serviceUrl.toString(),max:4});
  try{
    await client.query('CREATE TABLE customer(id integer PRIMARY KEY); INSERT INTO customer VALUES(1)');await client.query(readFileSync("../vpn/migrations/20261021000000_website_service.sql","utf8"));
    await client.query('CREATE TABLE package(id integer PRIMARY KEY,name text,"dataLimitGb" double precision,"priceMmk" numeric,"durationDays" integer,active boolean,"sortOrder" integer)');
    await client.query(`CREATE ROLE metro_website_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${backendPassword}'`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(readFileSync("../vpn/src/website-service/roles.sql","utf8"));
    await assert.rejects(pool.query('SELECT * FROM customer'));
    await assert.rejects(pool.query('UPDATE package SET name=name'));
    const require=createRequire(import.meta.url),{createWebsiteStore}=require("../../vpn/src/website-service/store.js"),{createWebsiteEngine}=require("../../vpn/src/website-service/engine.js");
    // Mirror the actual ORM's lowercase physical tables, not model names.
    await client.query('INSERT INTO package VALUES(1,\'Isolated catalog fixture\',100,5000,30,true,0),(2,\'Inactive fixture\',200,7500,30,false,1)');
    assert.deepEqual((await createWebsiteStore(pool).catalog()).packages,[{id:1,name:"Isolated catalog fixture",dataGb:100,monthlyPriceMmk:"5000",durationDays:30}]);
    assert.equal((await pool.query("SELECT has_table_privilege(current_user,'public.customer','SELECT,INSERT,UPDATE,DELETE') AS allowed")).rows[0].allowed,false);
    const keys=new Map<string,{id:string;accessUrl:string;dataLimit:{bytes:number}}>();let creations=0;
    const outline={async getAccessKeyById(id:string){return keys.get(id)??null;},async getAllAccessKeyUsage(){return{};},async createWebsiteAccessKey(id:string){creations++;if(!keys.has(id))keys.set(id,{id,accessUrl:"ss://isolated-only-"+id,dataLimit:{bytes:0}});return keys.get(id);},async setAccessKeyDataLimit(id:string,bytes:number){keys.get(id)!.dataLimit.bytes=bytes;},async deleteAccessKey(id:string){keys.delete(id);},isAccessKeyNotFoundError(){return false;}};
    const engine=createWebsiteEngine({store:createWebsiteStore(pool),outline,readUsage:async()=>({counterBytes:0,windowBytes:0,epoch:"isolated-counter-process"}),enabled:true}),owner={issuer:"metro-website",subject:randomUUID()},input={action:"fulfil",owner,operationId:randomUUID(),orderId:randomUUID(),quote:{owner,packageId:randomUUID(),policy:"metro-website-pricing.v1",currency:"MMK",baseDataGb:1,discountPercent:0,monthlyPriceMmk:"1000",regularMmk:"1000",savedMmk:"0",totalMmk:"1000",months:1,durationDays:30,quotaBytes:"1073741824"}};
    const [a,b]=await Promise.all([engine.execute(input),engine.execute(input)]);assert.equal(a.keyId,b.keyId);assert.equal(creations,1);assert.equal((await client.query('SELECT count(*)::int AS count FROM customer')).rows[0].count,1);
    const nonce=randomUUID(),store=createWebsiteStore(pool);assert.equal(await store.consumeNonce("test",nonce,new Date(Date.now()+60000)),true);assert.equal(await store.consumeNonce("test",nonce,new Date(Date.now()+60000)),false);
  }finally{await pool.end();await client.end();}
});
after(async()=>{await workerDb.$disconnect();await app.$disconnect();await admin.$disconnect();});
