import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { authenticatedSession, requireOwnerSession, createOwnerAuthorization, RECENT_AUTH_MS, FoundationError } from "../src/server/owner/authorization.ts";
import { getWebsiteRepositories, createDisposableRepositories } from "../src/server/website/disposable.ts";

let attempts=0;
const guard=mock.method(net.Socket.prototype,"connect",()=>{ attempts++; throw new Error("No external connections allowed."); });
after(()=>{ guard.mock.restore(); assert.equal(attempts,0); });
const now=new Date(); const userId=randomUUID();
const fresh={user:{id:userId},session:{id:randomUUID(),userId,createdAt:new Date(now.getTime()-1000),expiresAt:new Date(now.getTime()+60000)}};
const code=(value:string)=>(error:unknown)=>error instanceof FoundationError&&error.code===value;
test("immutable binding uses exact authenticated user ID, never email or supplied role",async()=>{
  const session=await authenticatedSession(async()=>({...fresh,user:{id:userId,email:"owner@example.invalid",role:"OWNER"}}),now);
  assert.throws(()=>requireOwnerSession(session,null,now),code("FORBIDDEN"));
  assert.throws(()=>requireOwnerSession(session,randomUUID(),now),code("FORBIDDEN"));
  assert.doesNotThrow(()=>requireOwnerSession(session,userId,now));
});
test("recent authentication uses real session creation, not user creation or session update time",async()=>{
  const old=await authenticatedSession(async()=>({...fresh,session:{...fresh.session,createdAt:new Date(now.getTime()-RECENT_AUTH_MS),updatedAt:now}}),now);
  assert.throws(()=>requireOwnerSession(old,userId,now),code("RECENT_AUTH_REQUIRED"));
  await assert.rejects(authenticatedSession(async()=>({user:fresh.user,session:{id:fresh.session.id,userId,expiresAt:fresh.session.expiresAt}}),now),code("UNAUTHENTICATED"));
});
test("expired, future-created, mismatched and missing sessions fail closed",async()=>{
  for(const candidate of [null,{...fresh,session:{...fresh.session,expiresAt:now}}, {...fresh,session:{...fresh.session,createdAt:new Date(now.getTime()+1000)}}, {...fresh,session:{...fresh.session,userId:randomUUID()}}]){
    await assert.rejects(authenticatedSession(async()=>candidate,now),code("UNAUTHENTICATED"));
  }
});
test("integration owner adapter defaults deny and binds the actual actor",async()=>{
  const request={actor:{issuer:"metro-website" as const,subject:userId},owner:{issuer:"metro-website" as const,subject:randomUUID()},permission:"payments:confirm" as const,operation:"payments.confirm" as const};
  assert.equal(await createOwnerAuthorization({readSession:async()=>fresh,now:()=>now})(request),false);
  const authorize=createOwnerAuthorization({readSession:async()=>fresh,readBinding:async()=>userId,now:()=>now});
  assert.equal(await authorize(request),true);
  assert.equal(await authorize({...request,actor:{...request.actor,subject:randomUUID()}}),false);
});
test("repositories remain disabled and production/database URL substitutions are rejected before networking",async()=>{
  assert.throws(()=>getWebsiteRepositories(),code("DISABLED"));
  for(const url of ["postgresql://invalid.invalid/website","postgresql://x@127.0.0.1:5432/neondb","postgresql://x@127.0.0.1:5432/postgres"]){
    await assert.rejects(createDisposableRepositories({url,marker:"0".repeat(64),readSession:async()=>fresh}),code("DISABLED"));
  }
});
test("prepared SQL only adds website tables and protects singleton, history and business uniqueness",()=>{
  const sql=readFileSync("prisma/migrations/20261020010000_website_owner_foundation/migration.sql","utf8");
  assert.equal((sql.match(/CREATE TABLE/g)??[]).length,11);
  assert.doesNotMatch(sql,/ALTER TABLE "metro_(user|session|account|verification|rate_limit)"|DROP TABLE|TRUNCATE TABLE|DELETE FROM|INSERT INTO public\.metro_owner_binding/);
  for(const invariant of ["metro_single_owner","metro_one_approved_payment","metro_owner_immutable","metro_audit_immutable","metro_operation_snapshot","metro_candidate_key_unique","metro_service_owner","metro_outbox_user_fkey"])assert.ok(sql.includes(invariant));
  assert.ok(sql.startsWith("-- Website foundation")); assert.ok(sql.trim().endsWith("COMMIT;"));
});
