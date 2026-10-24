import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { resolveAccountDestination } from "../src/server/auth/account-routing-policy.ts";
import { buildAdminAccess } from "../src/server/admin/access.ts";
import { FoundationError } from "../src/server/owner/authorization.ts";
import { AuthUnavailableError } from "../src/server/auth/index.ts";
import type { PrismaClient } from "../src/server/db/generated/client.ts";

let connections=0;const socket=mock.method(net.Socket.prototype,"connect",()=>{connections++;throw new Error("No network in isolated routing tests.");});
after(()=>{socket.mock.restore();assert.equal(connections,0);});
const owner=randomUUID(),customer=randomUUID();
const user=(id:string)=>({id,emailVerified:true});const binding=async()=>owner;
test("OWNER login and every customer dashboard destination resolve to admin",async()=>{
  for(const requested of [undefined,"/dashboard","/dashboard/services","/dashboard/settings","/admin","/checkout","https://evil.invalid"])
    assert.equal(await resolveAccountDestination(user(owner),requested,binding),"/admin");
});
test("CUSTOMER retains the customer workspace and safe purchase destinations",async()=>{
  assert.equal(await resolveAccountDestination(user(customer),undefined,binding),"/dashboard");
  for(const requested of ["/dashboard","/dashboard/settings","/checkout","/plans"])
    assert.equal(await resolveAccountDestination(user(customer),requested,binding),requested);
  for(const requested of ["/admin","/admin/customers","/admin/settings","//evil.invalid","https://evil.invalid"])
    assert.equal(await resolveAccountDestination(user(customer),requested,binding),"/dashboard");
});
test("email, supplied role and registration ordering cannot confer OWNER",async()=>{
  assert.equal(await resolveAccountDestination({...user(customer),email:"owner@example.invalid",role:"OWNER"},undefined,binding),"/dashboard");
  assert.equal(await resolveAccountDestination(user(customer),undefined,async()=>null),"/dashboard");
  await assert.rejects(resolveAccountDestination({...user(owner),emailVerified:false},undefined,binding),error=>error instanceof FoundationError&&error.code==="FORBIDDEN");
});
test("invalid identity or unavailable binding never fall back to a customer route",async()=>{
  await assert.rejects(resolveAccountDestination({id:owner},undefined,binding),error=>error instanceof FoundationError&&error.code==="UNAUTHENTICATED");
  await assert.rejects(resolveAccountDestination(user(owner),undefined,async()=>{throw new Error("unavailable");}),AuthUnavailableError);
  await assert.rejects(resolveAccountDestination(user(owner),undefined,async()=>"invalid-binding"),AuthUnavailableError);
});
test("direct CUSTOMER and anonymous admin operations fail before reading or mutating a resource",async()=>{
  const now=new Date();let resourceAccesses=0;
  function access(subject:string|null,age=1000){
    const row={id:randomUUID(),userId:subject,createdAt:new Date(now.getTime()-age),expiresAt:new Date(now.getTime()+60000)};
    const tx={$executeRaw:async()=>0,$queryRaw:async()=>[{nowMs:BigInt(now.getTime())}],session:{findFirst:async()=>row},ownerBinding:{findUnique:async()=>({userId:owner})},user:{findFirst:async()=>({id:owner,name:"Owner fixture",email:"owner@example.invalid"})}};
    return buildAdminAccess({$transaction:async(work:(value:unknown)=>unknown)=>work(tx)} as unknown as PrismaClient,async()=>subject?{user:{id:subject,emailVerified:true},session:row}:null);
  }
  const resource=async()=>{resourceAccesses++;return "safe result";};
  for(const recent of [false,true]){
    await assert.rejects(access(customer)(resource,recent),error=>error instanceof FoundationError&&error.code==="FORBIDDEN");
    await assert.rejects(access(null)(resource,recent),error=>error instanceof FoundationError&&error.code==="UNAUTHENTICATED");
  }
  assert.equal(resourceAccesses,0);
  assert.equal(await access(owner)(resource),"safe result");
  await assert.rejects(access(owner,300000)(resource,true),error=>error instanceof FoundationError&&error.code==="RECENT_AUTH_REQUIRED");
  assert.equal(resourceAccesses,1);
});
