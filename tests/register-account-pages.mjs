import './register-workspace-tests.mjs';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){
  const normalized=specifier.replaceAll('\\','/');
  if(normalized==='@/server/auth/canonical-origin'||/\/src\/server\/auth\/canonical-origin(?:\.ts)?$/.test(normalized))return {url:'data:text/javascript,export async function canonicalizeAuthPage(){}',shortCircuit:true};
  return nextResolve(specifier,context);
}});
