import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

await import('./verification/trusted-build-policy.mjs');

if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use the supported Node.js 24 runtime.');
const env = {};
for (const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','COMSPEC','PATHEXT','ProgramFiles','ProgramFiles(x86)']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { NODE_ENV:'test', NEXT_TELEMETRY_DISABLED:'1', METRO_AUTH_ENABLED:'false', METRO_WEBSITE_FOUNDATION_ENABLED:'false', METRO_FULFILMENT_ENABLED:'false', METRO_VPN_EXECUTION_APPROVED:'false', METRO_VPN_FULFILMENT_RECEIPTS_VERIFIED:'false', METRO_NOTIFICATIONS_ENABLED:'false', METRO_NOTIFICATION_EMAIL_ENABLED:'false', NODE_OPTIONS:`--max-old-space-size=2048 --import=${pathToFileURL(resolve('scripts/verification/loopback-only.mjs')).href}` });
const unit = readdirSync('tests').filter(name => name.endsWith('.test.mts') && !/(?:-db|restricted-auth|website-repositories|database-role-security|imagekit-live-authorization|workspace|account-pages|admin-ui|checkout-ui)\.test/.test(name)).map(name => 'tests/' + name);
const suites = {
  unit: ['--import','./tests/register-server-only.mjs','--import','tsx','--test','--test-concurrency=1',...unit],
  ui: ['--import','./tests/register-workspace-tests.mjs','--import','tsx','--test','tests/admin-ui.test.mts'],
  receipts: ['tests/run-fulfilment-receipts.mjs'], workers: ['tests/run-website-workers.mjs'],
  security: ['tests/run-security-remediation.mjs'], checkout: ['tests/run-checkout.mjs'], pricing: ['tests/run-admin-pricing.mjs'],
  foundation: ['tests/run-website-foundation.mjs','--release'], notifications: ['tests/run-notifications.mjs'],
  eslint: ['node_modules/eslint/bin/eslint.js','.','--max-warnings=0'],
  typescript: ['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
  prisma: ['node_modules/prisma/build/index.js','validate'], build: ['node_modules/next/dist/bin/next','build'],
};
const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(suites);
if (selected.some(name => !Object.hasOwn(suites,name))) throw new Error('Unknown release check.');
mkdirSync('.tmp/security-remediation',{recursive:true});
const results = [];
for (const name of selected) {
  console.log('Checking ' + name);
  const childEnv = {...env, NODE_ENV: ['build','prisma','eslint','typescript'].includes(name) ? 'production' : 'test'};
  const r = spawnSync(process.execPath,suites[name],{env:childEnv,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:12*1024*1024});
  const log = (r.stdout??'')+'\n'+(r.stderr??''); writeFileSync(`.tmp/security-remediation/${name}.log`,log);
  const count = label => Number(log.match(new RegExp(`(?:#|ℹ) ${label} (\\d+)`))?.[1] ?? 0);
  const result = {name,status:r.status===0?'PASS':'FAIL',exitCode:r.status,tests:count('tests'),passed:count('pass'),failed:count('fail')};
  results.push(result); console.log(JSON.stringify(result));
}
writeFileSync('.tmp/security-remediation/results-'+Date.now()+'.json',JSON.stringify(results,null,2));
if (results.some(r=>r.status!=='PASS')) process.exitCode=1;
