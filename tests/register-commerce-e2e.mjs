import './register-server-only.mjs';
import { registerHooks } from 'node:module';
// Isolated Node test process only. No hook is imported by Next or its build.
registerHooks({resolve(specifier,context,next){
 const name=specifier.replaceAll('\\','/');
 if(['@/server/website','@/server/pricing','@/server/admin','next/cache','next/headers'].includes(name)||/\/src\/server\/(?:website\/index|pricing\/index|admin\/index|auth\/session|env)(?:\.ts)?$/.test(name)||['@/server/env','@/server/auth/session'].includes(name))return {url:new URL('./commerce-e2e-fixture.mjs',import.meta.url).href,shortCircuit:true};
 const result=next(specifier,context);
 if(/\/src\/server\/(?:website\/index|pricing\/index|admin\/index|auth\/session|env)\.ts$/.test(result.url))return {url:new URL('./commerce-e2e-fixture.mjs',import.meta.url).href,shortCircuit:true};
 return result;
}});
