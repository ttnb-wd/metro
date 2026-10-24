import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { setSession, setOwnerBinding } from "./workspace-session-stub.mjs";
import LoginPage from "../src/app/(auth)/login/page.tsx";
import RegisterPage from "../src/app/(auth)/register/page.tsx";
import AccountEntry from "../src/app/(auth)/account/page.tsx";
import DashboardLayout from "../src/app/(workspace)/dashboard/layout.tsx";
let attempts=0;const socket=mock.method(net.Socket.prototype,"connect",()=>{attempts++;throw new Error("No network in isolated page tests.");});
after(()=>{socket.mock.restore();assert.equal(attempts,0);});
const owner=randomUUID(),customer=randomUUID();
const session=(id:string)=>({user:{id,name:"Isolated fixture",email:`${id}@example.invalid`,emailVerified:true},session:{id:randomUUID(),userId:id,createdAt:new Date(Date.now()-1000),expiresAt:new Date(Date.now()+60000)}});
const to=(path:string)=>(error:unknown)=>!!error&&typeof error==="object"&&"digest"in error&&String(error.digest).includes(`;${path};`);
test("signed-in OWNER reaches admin through Login, Get Started and post-login account entry",async()=>{
  setOwnerBinding(owner);setSession(session(owner));
  await assert.rejects(LoginPage({searchParams:Promise.resolve({})}),to("/admin"));
  await assert.rejects(RegisterPage({searchParams:Promise.resolve({})}),to("/admin"));
  await assert.rejects(AccountEntry({searchParams:Promise.resolve({next:"/dashboard"})}),to("/admin"));
});
test("OWNER never renders the customer dashboard shell; CUSTOMER keeps it",async()=>{
  setOwnerBinding(owner);setSession(session(owner));
  await assert.rejects(DashboardLayout({children:"customer-only content"}),to("/admin"));
  setSession(session(customer));const layout=await DashboardLayout({children:"customer-only content"});
  assert.equal(layout.props.account.name,"Isolated fixture");
  assert.equal(layout.props.children,"customer-only content");
});
test("CUSTOMER Login/Get Started and admin callbacks route to the customer dashboard",async()=>{
  setOwnerBinding(owner);setSession(session(customer));
  await assert.rejects(LoginPage({searchParams:Promise.resolve({})}),to("/dashboard"));
  await assert.rejects(RegisterPage({searchParams:Promise.resolve({})}),to("/dashboard"));
  await assert.rejects(AccountEntry({searchParams:Promise.resolve({next:"/admin"})}),to("/dashboard"));
  await assert.rejects(AccountEntry({searchParams:Promise.resolve({next:"/checkout"})}),to("/checkout"));
});
test("anonymous account entry requires login while Login and Get Started remain usable",async()=>{
  setOwnerBinding(owner);setSession(null);
  await assert.rejects(AccountEntry({searchParams:Promise.resolve({})}),/TEST_REJECTED_ANONYMOUS/);
  const login=await LoginPage({searchParams:Promise.resolve({})});assert.equal(login.props.mode,"login");
  const register=await RegisterPage({searchParams:Promise.resolve({})});assert.equal(register.props.mode,"register");
});
