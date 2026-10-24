import {test,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {profileNameInput,profileSessionError} from '../src/server/auth/profile.ts';
import {assertWebsiteTargetUrl,WEBSITE_DIRECT_HOST,WEBSITE_ROLES} from '../src/server/db/target-policy.ts';
import {getWebsiteRepositories} from '../src/server/website/index.ts';
import {parseServerEnvironment} from '../src/server/env.ts';
import {grantsSql,identifier} from '../scripts/foundation/roles.mjs';
let attempts=0;const guard=mock.method(net.Socket.prototype,'connect',()=>{attempts++;throw new Error('Isolated network guard');});after(()=>{guard.mock.restore();assert.equal(attempts,0);});
test('runtime/migration targets are exact and cannot target Aiven, a different Neon project or an unexpected role',()=>{
  const base=`postgresql://metro_migrator:unused@${WEBSITE_DIRECT_HOST}/neondb?sslmode=verify-full`;
  assert.ok(assertWebsiteTargetUrl(base,WEBSITE_ROLES.migration,false));
  assert.ok(assertWebsiteTargetUrl(base.replace('metro_migrator','metro_runtime').replace('.c-3.','-pooler.c-3.'),WEBSITE_ROLES.runtime,true));
  for(const bad of [base.replace(WEBSITE_DIRECT_HOST,'vpn.aivencloud.com'),base.replace('ep-floral-lab','ep-other'),base.replace('metro_migrator','metro_runtime'),base.replace('verify-full','require'),base+'&sslmode=disable',base.replace('neondb','other')])assert.throws(()=>assertWebsiteTargetUrl(bad,WEBSITE_ROLES.migration,false));
});
test('production repository path defaults deny before connecting',async()=>{
  await assert.rejects(getWebsiteRepositories(),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='DISABLED');
});
test('restricted runtime rejects direct administrative credentials and legacy foundation activation',()=>{
  const source={NODE_ENV:'test',METRO_AUTH_ENABLED:'true',METRO_DATABASE_URL:`postgresql://metro_runtime:unused@${WEBSITE_DIRECT_HOST.replace('.','-pooler.')}/neondb?sslmode=verify-full`,BETTER_AUTH_SECRET:'isolated-configuration-secret-with-enough-entropy-12345',BETTER_AUTH_URL:'http://127.0.0.1:3000',METRO_DATABASE_RUNTIME_ROLE:'metro_runtime'};
  assert.ok(parseServerEnvironment(source).enabled);
  assert.throws(()=>parseServerEnvironment({...source,METRO_DIRECT_DATABASE_URL:`postgresql://metro_migrator:unused@${WEBSITE_DIRECT_HOST}/neondb?sslmode=verify-full`}));
  assert.throws(()=>parseServerEnvironment({...source,METRO_DATABASE_RUNTIME_ROLE:'neondb_owner',METRO_WEBSITE_FOUNDATION_ENABLED:'true'}));
});
test('profile accepts only a bounded display name, never identity/role/verification fields',()=>{
  assert.deepEqual(profileNameInput({name:'  Admin  '}),{name:'Admin'});
  for(const input of [{name:''},{name:'x'.repeat(81)},{name:'Admin\nOWNER'},{name:'Admin',userId:randomUUID()},{name:'Admin',role:'OWNER'},{name:'Admin',emailVerified:true},{name:'Admin',email:'other@example.invalid'}])assert.equal(profileNameInput(input),null);
});
test('profile requires a verified session and rejects expired or five-minute-old authentication',()=>{
  const now=new Date(),id=randomUUID(),fresh={user:{id,emailVerified:true},session:{userId:id,createdAt:new Date(now.getTime()-1000),expiresAt:new Date(now.getTime()+60000)}};
  assert.equal(profileSessionError(fresh,now),null);
  assert.equal(profileSessionError({...fresh,user:{...fresh.user,emailVerified:false}},now),'UNAUTHENTICATED');
  assert.equal(profileSessionError({...fresh,session:{...fresh.session,userId:randomUUID()}},now),'UNAUTHENTICATED');
  assert.equal(profileSessionError({...fresh,session:{...fresh.session,expiresAt:now}},now),'UNAUTHENTICATED');
  assert.equal(profileSessionError({...fresh,session:{...fresh.session,createdAt:new Date(now.getTime()-300000)}},now),'RECENT_AUTH_REQUIRED');
});
test('grant plan separates table ownership, narrow readiness metadata and one-time assignment',()=>{
  const sql=grantsSql();assert.match(sql,/GRANT SELECT\(migration_name,finished_at,rolled_back_at\)/);
  assert.ok(!/GRANT ALL|GRANT INSERT[^;]*metro_owner_binding[^;]*metro_runtime/.test(sql));
  assert.throws(()=>identifier('metro_runtime; DROP TABLE metro_user'));
});
test('production tooling defaults offline and requires separate exact-action approval before connection',()=>{
  const source=readFileSync('scripts/website-foundation.mts','utf8');
  assert.match(source,/action===\"plan\"/);assert.ok(source.indexOf('receipt.approved!==true')<source.indexOf('const admin=await connection'));
  assert.ok(source.includes('productionBackupReady'));assert.ok(source.includes('freshLoginAndIndependentControlConfirmed'));
});
