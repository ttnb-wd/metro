import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { setSession, calls } from "./workspace-session-stub.mjs";

let connectionAttempts = 0;
const guard = mock.method(net.Socket.prototype, 'connect', () => { connectionAttempts++; throw new Error('No database/network in component tests.'); });
after(() => { guard.mock.restore(); assert.equal(connectionAttempts, 0); });

const { accountInitials } = await import('../src/features/workspace/identity.ts');
const { DashboardShell } = await import('../src/components/dashboard/dashboard-shell.tsx');
const { SecureAccessView, SettingsView } = await import('../src/components/dashboard/workspace-views.tsx');
const { default: DashboardLayout } = await import('../src/app/(workspace)/dashboard/layout.tsx');
const fixture = { user:{ id:'00000000-0000-4000-8000-000000000001', name:'Workspace Fixture', email:'fixture@example.invalid', emailVerified:true, createdAt:new Date('2026-10-20T06:00:00Z') }, session:{ token:'never-forward-this-test-token' } };
const router = { push(){}, replace(){}, refresh(){}, back(){}, forward(){}, prefetch(){} };
// Resolve actual async server components before the isolated DOM render. Data
// is supplied by the fixture adapter; guards and view logic remain real.
async function resolveServer(content: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(content)) return React.Children.toArray(await Promise.all(content.map(resolveServer)));
  if (!React.isValidElement<{children?:React.ReactNode}>(content)) return content;
  if (typeof content.type === 'function' && content.type.constructor.name === 'AsyncFunction') {
    return resolveServer(await (content.type as (props:unknown)=>Promise<React.ReactNode>)(content.props));
  }
  if (content.props.children) return React.cloneElement(content,{children:await resolveServer(content.props.children)});
  return content;
}
function render(content: React.ReactNode, pathname='/dashboard') {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, {value:router}, React.createElement(PathnameContext.Provider, {value:pathname}, content)));
}

const routes = [
  ['/dashboard', () => import('../src/app/(workspace)/dashboard/page.tsx'), 'Welcome,'],
  ['/dashboard/services', () => import('../src/app/(workspace)/dashboard/services/page.tsx'), 'My services'],
  ['/dashboard/secure-access', () => import('../src/app/(workspace)/dashboard/secure-access/page.tsx'), 'Secure Access'],
  ['/dashboard/orders', () => import('../src/app/(workspace)/dashboard/orders/page.tsx'), 'Orders'],
  ['/dashboard/billing', () => import('../src/app/(workspace)/dashboard/billing/page.tsx'), 'Billing'],
  ['/dashboard/settings', () => import('../src/app/(workspace)/dashboard/settings/page.tsx'), 'Settings'],
] as const;

for (const [path, load, heading] of routes) {
  test(`${path} rejects anonymous rendering and renders only after its exact session guard`, async () => {
    const {default:Page} = await load();
    setSession(null); await assert.rejects(() => Page(), /TEST_REJECTED_ANONYMOUS/); assert.deepEqual(calls,[path]);
    setSession(fixture); const page=await Page(); assert.deepEqual(calls,[path]);
    const html=render(await resolveServer(page),path); assert.ok(html.includes(heading)); assert.ok(!html.includes(fixture.session.token));
    assert.equal((html.match(/<h1\b/g)??[]).length,1);
  });
}

test('server layout forwards only authenticated name/email to the client shell', async () => {
  setSession(fixture);
  const layout=await DashboardLayout({children:React.createElement('p',null,'child')});
  assert.deepEqual(Object.keys(layout.props.account).sort(),['email','name']);
  assert.deepEqual(layout.props.account,{name:fixture.user.name,email:fixture.user.email});
});

test('workspace shell has its own navigation and landmarks, without the public dock', () => {
  const html=render(React.createElement(DashboardShell,{account:fixture.user},React.createElement('h1',null,'Test workspace')),'/dashboard/services');
  assert.equal((html.match(/<main\b/g)??[]).length,1);
  assert.ok(html.includes('aria-label="Workspace navigation"'));
  assert.ok(html.includes('aria-label="Quick workspace navigation"'));
  assert.ok(html.includes('aria-label="Open account menu"'));
  assert.ok(html.includes('aria-label="Open workspace navigation"'));
  assert.ok((html.match(/<a\b[^>]*>/g)??[]).some(tag=>tag.includes('href="/dashboard/services"')&&tag.includes('aria-current="page"')));
  assert.ok(!html.includes('split-dock'));
});

test('Secure Access exposes no fabricated entitlement, key, usage or working service actions', () => {
  const html=render(React.createElement(SecureAccessView));
  for(const text of ['No active service','Not linked','Unavailable','Subscription','Expiry','Data allowance','Usage']) assert.ok(html.includes(text));
  assert.ok(!/<(?:a|button)[^>]*>[^<]*(?:Connect|Renew|Copy Key)/i.test(html));
  assert.ok(!/ss:\/\/|0 GB|100 GB|connected successfully|active subscription/i.test(html));
});

test('settings renders only the supplied identity and escapes name content', () => {
  const html=render(React.createElement(SettingsView,{account:{...fixture.user,name:'<script>fixture</script>'}}));
  assert.ok(html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
  assert.ok(!html.includes('<script>fixture'));
  assert.ok(html.includes(fixture.user.email));
  assert.ok(html.includes('Oct 20, 2026'));
  assert.ok(html.includes('Log out'));
});

test('account initials are stable, bounded, and safe for empty and Unicode names', () => {
  assert.equal(accountInitials('  Metro   Member  '),'MM');
  assert.equal(accountInitials('Metro'),'M');
  assert.equal(accountInitials(''),'M');
  assert.equal(Array.from(accountInitials('ß ß')).length,2);
});

test('public UI, brand, auth columns and the reviewed server/auth baseline remain protected', () => {
  // Server hashes were explicitly refreshed for the reviewed email verification,
  // restricted-role readiness and name-only update. Behavioral auth tests remain.
  const baseline=JSON.parse(readFileSync('tests/step05-protected-baseline.json','utf8'));
  for(const [path,hash] of Object.entries(baseline)) {
    let content=readFileSync(path);
    if(path==='src/app/layout.tsx') {
      const source=content.toString('utf8');
      assert.equal((source.match(/ data-scroll-behavior="smooth"/g)??[]).length,1);
      content=Buffer.from(source.replace(' data-scroll-behavior="smooth"',''));
    }
    if(path==='prisma/schema.prisma') {
      const originalAuth=content.toString('utf8')
        .replace(/\n  \/\/ BEGIN website foundation back-relations[\s\S]*?\n  \/\/ END website foundation back-relations/,'')
        .split('// BEGIN Step 06B.2 additive website foundation')[0].trimEnd()+'\n';
      content=Buffer.from(originalAuth);
    }
    assert.equal(createHash('sha256').update(content).digest('hex'),hash,path);
  }
});
