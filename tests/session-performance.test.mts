import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const state={cookie:'',ready:0,sessions:0,foundation:0,fail:false};
(globalThis as unknown as {metroSessionPerformance:typeof state}).metroSessionPerformance=state;
const fixture='data:text/javascript,'+encodeURIComponent(`const s=globalThis.metroSessionPerformance;export async function headers(){return new Headers(s.cookie?{cookie:s.cookie}:{})}export function readServerEnvironment(){return {enabled:true}}export class AuthUnavailableError extends Error{};export async function assertWebsiteDatabaseReady(){s.ready++;if(s.fail)throw Error('fixture')}export function getAuth(){return {api:{async getSession(){s.sessions++;return null}}}}export async function getAccountDestination(){throw Error('not used')}`);
const adminFixture='data:text/javascript,'+encodeURIComponent(`export async function foundationDatabase(){globalThis.metroSessionPerformance.foundation++;throw Error('must not open database')}export function buildAdminRepository(){throw Error('must not construct repository')}`);
registerHooks({resolve(name,context,next){if(context.parentURL?.endsWith('/admin/index.ts')&&['../website','./repository'].includes(name))return {url:adminFixture,shortCircuit:true};if(['next/headers','@/server/auth','@/server/env','@/server/db/verify-target'].includes(name)||name==='./account-routing'&&context.parentURL?.endsWith('/auth/session.ts'))return {url:fixture,shortCircuit:true};return next(name,context);}});
test('cookie-free navigation avoids database work, while cookie-bearing sessions still fail closed',async()=>{
 const {getWebsiteSession}=await import('../src/server/auth/session.ts');
 assert.equal(await getWebsiteSession(),null);assert.equal(state.ready,0);assert.equal(state.sessions,0);
 state.cookie='better-auth.session_token=isolated-not-a-session';assert.equal(await getWebsiteSession(),null);assert.equal(state.ready,1);assert.equal(state.sessions,1);
 state.fail=true;await assert.rejects(getWebsiteSession());assert.equal(state.ready,2);assert.equal(state.sessions,1);
});
test('anonymous administration fails closed before foundation database work',async()=>{
 state.cookie='';state.fail=false;
 const {getAdminRepository}=await import('../src/server/admin/index.ts');
 await assert.rejects(getAdminRepository(),{code:'UNAUTHENTICATED'});
 assert.equal(state.foundation,0);
});
