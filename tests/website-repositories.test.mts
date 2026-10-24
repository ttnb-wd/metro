import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { PrismaClient } from "../src/server/db/generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { createDisposableRepositories } from "../src/server/website/disposable.ts";
import { FoundationError } from "../src/server/owner/authorization.ts";
import { priceQuote } from "../src/server/vpn/policy.ts";
import { WEBSITE_ISSUER } from "../src/server/vpn/contracts.ts";
import { betterAuth } from "better-auth";
import { createAuthOptions } from "../src/server/auth/options.ts";
import { Client } from "pg";
import { assignOwner } from "../scripts/foundation/assign-owner.mjs";
import { revokeAssignmentSql } from "../scripts/foundation/roles.mjs";

const appUrl=process.env.METRO_DISPOSABLE_APP_URL;
const bootstrapUrl=process.env.METRO_DISPOSABLE_BOOTSTRAP_URL;
const marker=process.env.METRO_DISPOSABLE_MARKER;
if(!appUrl||!bootstrapUrl||!marker){ test("repository integration needs the owned disposable runner",{skip:true},()=>{}); }
else {
  for(const value of [appUrl,bootstrapUrl]){ const url=new URL(value); assert.equal(url.hostname,"127.0.0.1"); assert.match(url.pathname,/^\/metro_disposable_[a-f0-9]{16}$/); }
  const admin=new PrismaClient({adapter:new PrismaPg({connectionString:bootstrapUrl,max:4}),log:[],errorFormat:"minimal"});
  const app=new PrismaClient({adapter:new PrismaPg({connectionString:appUrl,max:4}),log:[],errorFormat:"minimal"});
  const now=new Date(); const user=randomUUID(),other=randomUUID(),owner=randomUUID();
  for(const id of [user,other,owner])await admin.user.create({data:{id,name:"Isolated fixture",email:`${id}@example.invalid`,emailVerified:id===owner}});
  await admin.account.create({data:{userId:owner,accountId:owner,providerId:'credential'}});
  async function session(userId:string,age=1000){return admin.session.create({data:{userId,token:randomBytes(32).toString("hex"),createdAt:new Date(now.getTime()-age),expiresAt:new Date(now.getTime()+3600000)}});}
  const sessions={user:await session(user),other:await session(other),owner:await session(owner),old:await session(owner,600000)};
  const connections:Awaited<ReturnType<typeof createDisposableRepositories>>[]=[];
  async function connection(row:typeof sessions.user){const result=await createDisposableRepositories({url:appUrl!,marker:marker!,readSession:async()=>({user:{id:row.userId},session:{id:row.id,userId:row.userId,createdAt:row.createdAt,expiresAt:row.expiresAt}})});connections.push(result);return result.repositories;}
  const customer=await connection(sessions.user),foreign=await connection(sessions.other),operator=await connection(sessions.owner),stale=await connection(sessions.old);
  after(async()=>{ await Promise.all(connections.map(c=>c.close())); await app.$disconnect(); await admin.$disconnect(); });
  const metadata=()=>({requestId:randomUUID(),idempotencyKey:randomUUID()});
  const code=(value:string)=>(error:unknown)=>error instanceof FoundationError&&error.code===value;
  function quote(subject=user){return priceQuote({id:randomUUID(),owner:{issuer:WEBSITE_ISSUER,subject},pkg:{id:"fixture-package",name:"Fixture only",monthlyPriceMmk:"5000",monthlyQuotaBytes:"1000",baseDurationDays:30},catalogVersion:"fixture-v1",months:2,validUntil:new Date(Date.now()+600000).toISOString()});}
  async function purchase(){const q=quote();const order=await customer.createOrder(q,metadata()); const evidence=await customer.addEvidence({orderId:order.id,storageRef:randomUUID(),sha256:"a".repeat(64),mediaType:"image/png",bytes:1234},metadata()); return {q,order,evidence};}
  const snapshot={id:"fixture-entitlement",owner:{issuer:WEBSITE_ISSUER,subject:user},packageId:"fixture-package",version:3,status:"ACTIVE",keyId:"fixture-original-id",keyStatus:"ENFORCED",expiresAt:new Date(now.getTime()+60*86400000).toISOString(),totalBytes:"2000",usedBytes:"600",remainingBytes:"1400",usageHistoryVersion:2,observedAt:now.toISOString()};
  const service=await admin.websiteServiceReference.create({data:{userId:user,externalId:snapshot.id,snapshot,version:3}});
  test("unassigned OWNER defaults deny; only an isolated fixture is manually bound once",async()=>{
    await assert.rejects(operator.ownerRecords(user,metadata()),code("FORBIDDEN"));
    if(process.env.METRO_DISPOSABLE_OPERATOR_URL){
      const url=new URL(process.env.METRO_DISPOSABLE_OPERATOR_URL);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,new URL(appUrl!).pathname);
      const operator=new Client({connectionString:url.toString()});await operator.connect();
      try {
        await assert.rejects(assignOwner(operator,{userId:user,email:`${user}@example.invalid`,role:'metro_disposable_operator'}));
        await assignOwner(operator,{userId:owner,email:`${owner}@example.invalid`,role:'metro_disposable_operator'});
        assert.equal((await operator.query("SELECT count(*)::int AS n FROM metro_owner_audit WHERE action='OWNER_BOUND' AND \"actorId\"=$1",[owner])).rows[0].n,1);
        await assert.rejects(assignOwner(operator,{userId:owner,email:`${owner}@example.invalid`,role:'metro_disposable_operator'}));
        await admin.$executeRawUnsafe(revokeAssignmentSql({runtime:'metro_disposable_app',migration:'metro_disposable_migrator',assignment:'metro_disposable_operator'}));
        await assert.rejects(operator.query('INSERT INTO metro_owner_binding(slot,"userId") VALUES(1,$1)',[other]),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='42501');
      }finally{await operator.end();}
    }else await admin.ownerBinding.create({data:{slot:1,userId:owner}});
    await assert.rejects(app.ownerBinding.create({data:{slot:1,userId:other}}));
    await assert.rejects(admin.ownerBinding.create({data:{slot:2,userId:other}}));
    await assert.rejects(admin.ownerBinding.update({where:{slot:1},data:{userId:other}}));
    await assert.rejects(admin.ownerBinding.delete({where:{slot:1}}));
    assert.equal((await admin.ownerBinding.findUniqueOrThrow({where:{slot:1}})).userId,owner);
  });
  test("freshness uses the persisted session, and CUSTOMER cannot execute OWNER repositories",async()=>{
    await assert.rejects(stale.ownerRecords(user,metadata()),code("RECENT_AUTH_REQUIRED"));
    await assert.rejects(customer.ownerRecords(user,metadata()),code("FORBIDDEN"));
    assert.equal((await operator.ownerRecords(user,metadata())).orders.length,0);
  });
  test("order/evidence repositories isolate customers and preserve immutable accepted quotes",async()=>{
    const {q,order}=await purchase();
    await assert.rejects(foreign.order(order.id),code("NOT_FOUND"));
    await assert.rejects(foreign.createOrder(q,metadata()),code("NOT_FOUND"));
    await assert.rejects(foreign.addEvidence({orderId:order.id,storageRef:randomUUID(),sha256:"a".repeat(64),mediaType:"image/png",bytes:1},metadata()),code("NOT_FOUND"));
    await assert.rejects(foreign.listEvidence(order.id),code("NOT_FOUND"));
    await assert.rejects(app.websiteOrder.update({where:{id:order.id},data:{totalMmk:"1"}}));
    const evidence=await customer.listEvidence(order.id); assert.equal(evidence.length,1); assert.ok(!("storageRef" in evidence[0]));
  });
  test("same key/payload replays after reconnect; changed payload conflicts; concurrent order creation deduplicates",async()=>{
    const q=quote(); const m=metadata();
    const results=await Promise.all(Array.from({length:6},()=>customer.createOrder(q,m)));
    assert.equal(new Set(results.map(r=>r.id)).size,1);
    const restarted=await connection(sessions.user);
    assert.deepEqual(await restarted.createOrder(q,m),results[0]);
    await assert.rejects(customer.createOrder(quote(),m),code("CONFLICT"));
    assert.equal(await admin.websiteOrder.count({where:{quoteId:q.id}}),1);
  });
  test("OWNER decisions enforce evidence ownership, amount and unique business confirmation",async()=>{
    const {q,order,evidence}=await purchase();
    const input={userId:user,orderId:order.id,evidenceId:evidence.id,reviewedVersion:1,reviewedSha256:"a".repeat(64),verificationRef:randomUUID(),amountMmk:q.totalMmk,decision:"APPROVED"};
    await assert.rejects(customer.decidePayment(input,metadata()),code("FORBIDDEN"));
    await assert.rejects(operator.decidePayment({...input,amountMmk:"1"},metadata()),code("CONFLICT"));
    const results=await Promise.all(Array.from({length:6},()=>operator.decidePayment(input,metadata())));
    assert.equal(new Set(results.map(r=>r.id)).size,1);
    assert.equal(await admin.paymentDecision.count({where:{orderId:order.id,decision:"APPROVED"}}),1);
    assert.equal(await admin.websiteOperation.count({where:{orderId:order.id}}),1);
    assert.equal(await admin.websiteOutboxEvent.count({where:{businessKey:`fulfil:${order.id}`}}),1);
    await assert.rejects(operator.decidePayment({...input,verificationRef:randomUUID()},metadata()),code("CONFLICT"));
    const second=await purchase();
    await assert.rejects(operator.decidePayment({...input,orderId:second.order.id,evidenceId:second.evidence.id},metadata()),code("CONFLICT"));
    assert.equal((await customer.order(order.id)).provisioning,"QUEUED");
  });
  test("audit failure rolls back approval, operation, idempotency receipt and outbox; retry succeeds once",async()=>{
    const {q,order,evidence}=await purchase(); const m=metadata();
    const input={userId:user,orderId:order.id,evidenceId:evidence.id,reviewedVersion:1,reviewedSha256:"a".repeat(64),verificationRef:randomUUID(),amountMmk:q.totalMmk,decision:"APPROVED"};
    await admin.$executeRawUnsafe(`CREATE FUNCTION metro_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PAYMENT_DECISION' AND NEW.outcome='SUCCESS' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END; $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER metro_test_audit_failure BEFORE INSERT ON metro_owner_audit FOR EACH ROW EXECUTE FUNCTION metro_test_audit_failure()`);
    try{await assert.rejects(operator.decidePayment(input,m),code("UNAVAILABLE"));}
    finally{await admin.$executeRawUnsafe("DROP TRIGGER metro_test_audit_failure ON metro_owner_audit");await admin.$executeRawUnsafe("DROP FUNCTION metro_test_audit_failure()");}
    assert.equal((await customer.order(order.id)).payment,"UNDER_REVIEW");
    assert.equal(await admin.paymentDecision.count({where:{orderId:order.id}}),0);
    assert.equal(await admin.websiteOperation.count({where:{orderId:order.id}}),0);
    assert.equal(await admin.websiteRequest.count({where:{key:m.idempotencyKey}}),0);
    await operator.decidePayment(input,m);
    assert.equal(await admin.websiteOperation.count({where:{orderId:order.id}}),1);
  });
  test("issue ownership, successful admin test and exactly three durable retries",async()=>{
    await assert.rejects(foreign.reportIssue({serviceId:service.id,category:"CANNOT_CONNECT",description:"Fixture"},metadata()),code("NOT_FOUND"));
    const issue=await customer.reportIssue({serviceId:service.id,category:"CANNOT_CONNECT",description:"Fixture connection issue"},metadata());
    assert.equal(await admin.websiteOutboxEvent.count({where:{businessKey:`issue:${issue.id}`}}),1);
    await operator.recordDiagnosis({userId:user,issueId:issue.id,version:0,result:"SUCCEEDED"},metadata());
    await assert.rejects(operator.requestReplacement({userId:user,serviceId:service.id,issueId:issue.id,expectedVersion:3},metadata()),code("CONFLICT"));
    for(let attempt=0;attempt<3;attempt++){
      const m=metadata(),input={issueId:issue.id,version:attempt+1,expectedAttempt:attempt,result:"FAILED"};
      await customer.recordRetry(input,m);await customer.recordRetry(input,m);
      await assert.rejects(foreign.recordRetry(input,metadata()),code("NOT_FOUND"));
    }
    const stored=await admin.supportIssue.findUniqueOrThrow({where:{id:issue.id},include:{events:true}});
    assert.equal(stored.attempts,3);assert.equal(stored.state,"REVIEW_REQUIRED");assert.equal(stored.events.length,5);
    await assert.rejects(customer.recordRetry({issueId:issue.id,version:4,expectedAttempt:2,result:"FAILED"},metadata()),code("CONFLICT"));
  });
  test("verified failure creates one durable replacement intent while preserving the complete snapshot",async()=>{
    const issue=await customer.reportIssue({serviceId:service.id,category:"CANNOT_CONNECT",description:"Fixture key failure"},metadata());
    await operator.recordDiagnosis({userId:user,issueId:issue.id,version:0,result:"FAILED"},metadata());
    const input={userId:user,serviceId:service.id,issueId:issue.id,expectedVersion:3};
    const results=await Promise.all(Array.from({length:5},()=>operator.requestReplacement(input,metadata())));
    assert.equal(new Set(results.map(r=>r.id)).size,1);
    const operation=await admin.websiteOperation.findUniqueOrThrow({where:{id:results[0].id}});
    assert.deepEqual(operation.frozenSnapshot,snapshot);assert.equal(operation.candidateKeyId,null);assert.equal(operation.state,"QUEUED");
    assert.deepEqual((await admin.websiteServiceReference.findUniqueOrThrow({where:{id:service.id}})).snapshot,snapshot);
    await assert.rejects(app.websiteOperation.update({where:{id:operation.id},data:{frozenSnapshot:{remainingBytes:"9999"}}}));
    await assert.rejects(operator.requestReplacement({...input,expectedVersion:4},metadata()),code("CONFLICT"));
  });
  test("checkpoint CAS rejects stale writes and cannot declare real provisioning success",async()=>{
    const operation=await admin.websiteOperation.findFirstOrThrow({where:{kind:"PROVISION"}});
    const input={userId:user,operationId:operation.id,version:0,state:"PROCESSING"}; const m=metadata();
    await operator.checkpoint(input,m);await operator.checkpoint(input,m);
    await assert.rejects(operator.checkpoint({...input,state:"REVIEW_REQUIRED"},metadata()),code("CONFLICT"));
    await assert.rejects(operator.checkpoint({...input,version:1,state:"SUCCEEDED"},metadata()),code("INVALID_REQUEST"));
    await operator.checkpoint({...input,version:1,state:"RETRY_PENDING"},metadata());
  });
  test("outbox leases fence stale workers and survive expired claim recovery",async()=>{
    const event=await admin.websiteOutboxEvent.findFirstOrThrow({where:{state:"PENDING",userId:user}});
    await operator.claimOutbox({userId:user,eventId:event.id,version:0},metadata());
    const first=await admin.websiteOutboxEvent.findUniqueOrThrow({where:{id:event.id}});
    await assert.rejects(operator.acknowledgeOutbox({userId:user,eventId:event.id,version:first.version,leaseId:randomUUID()},metadata()),code("CONFLICT"));
    await admin.websiteOutboxEvent.update({where:{id:event.id},data:{leaseUntil:new Date(Date.now()-1000)}});
    await operator.claimOutbox({userId:user,eventId:event.id,version:first.version},metadata());
    const second=await admin.websiteOutboxEvent.findUniqueOrThrow({where:{id:event.id}});
    assert.notEqual(second.leaseId,first.leaseId);
    await assert.rejects(operator.acknowledgeOutbox({userId:user,eventId:event.id,version:first.version,leaseId:first.leaseId},metadata()),code("CONFLICT"));
    await operator.acknowledgeOutbox({userId:user,eventId:event.id,version:second.version,leaseId:second.leaseId},metadata());
    assert.equal((await admin.websiteOutboxEvent.findUniqueOrThrow({where:{id:event.id}})).state,"DELIVERED");
  });
  test("database constraints reject cross-owner evidence, duplicate approvals and history mutation",async()=>{
    const order=await admin.websiteOrder.findFirstOrThrow({where:{userId:user}});
    await assert.rejects(app.paymentEvidence.create({data:{orderId:order.id,userId:other,storageRef:randomUUID(),sha256:"a".repeat(64),mediaType:"image/png",bytes:1}}));
    const decision=await admin.paymentDecision.findFirstOrThrow({where:{decision:"APPROVED"}});
    await assert.rejects(app.paymentDecision.create({data:{orderId:decision.orderId,userId:user,evidenceId:decision.evidenceId,decision:"APPROVED",verificationRef:randomUUID(),amountMmk:decision.amountMmk,ownerId:owner,reasonCode:"PAYMENT_MATCHED"}}));
    const event=await admin.websiteAuditEvent.findFirstOrThrow();
    await assert.rejects(app.websiteAuditEvent.delete({where:{id:event.id}}));
    await assert.rejects(admin.websiteAuditEvent.update({where:{id:event.id},data:{reasonCode:"OWNER_READ"}}));
    const json=JSON.stringify(await operator.ownerRecords(user,metadata()));
    assert.ok(!json.includes("ss://"));assert.ok(!json.includes(sessions.owner.token));
  });
  test("session revocation is checked against the database on every repository call",async()=>{
    const revoked=await session(other);const repositories=await connection(revoked);
    await admin.session.delete({where:{id:revoked.id}});
    await assert.rejects(repositories.listOrders(),code("UNAUTHENTICATED"));
  });
  test("actual Better Auth registration cannot grant OWNER from extra submitted fields",async()=>{
    const origin="http://127.0.0.1:3999",email=`${randomUUID()}@example.invalid`;
    const auth=betterAuth(createAuthOptions({enabled:true,nodeEnv:"test",databaseUrl:appUrl!,secret:randomBytes(48).toString("base64url"),origin},app,async()=>{}));
    const response=await auth.handler(new Request(`${origin}/api/auth/sign-up/email`,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify({name:"Isolated registration",email,password:randomBytes(32).toString("hex"),role:"OWNER",ownerBinding:{slot:1}})}));
    assert.ok([200,201,400,422].includes(response.status));
    assert.equal((await admin.ownerBinding.findUniqueOrThrow({where:{slot:1}})).userId,owner);
    const registered=await admin.user.findUnique({where:{email}});
    if(registered)assert.equal(await admin.ownerBinding.count({where:{userId:registered.id}}),0);
  });
}
