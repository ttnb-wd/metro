import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalWebsitePageUrl } from '../src/features/auth/canonical-website.ts';
import { assertSameOrigin } from '../src/server/admin/request.ts';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy.ts';
import { CANONICAL_NAVIGATION_HEADER } from '../src/features/auth/canonical-website.ts';

const environment = { origin: 'http://127.0.0.1:3000', nodeEnv: 'development' };
test('page navigation canonicalizes loopback aliases with checkout selection intact', () => {
  for (const path of ['/', '/plans', '/checkout', '/setup', '/dashboard', '/admin/payment-approvals']) {
    assert.equal(canonicalWebsitePageUrl(environment, 'localhost:3000', path, '?months=3'), `${environment.origin}${path}?months=3`);
    assert.equal(canonicalWebsitePageUrl(environment, '[::1]:3000', path), `${environment.origin}${path}`);
  }
  for (const host of ['evil.invalid:3000', 'localhost:3001', '127.0.0.1:3000', null]) assert.equal(canonicalWebsitePageUrl(environment, host, '/plans'), null);
  assert.equal(canonicalWebsitePageUrl(environment, 'localhost:3000', '//evil.invalid'), null);
  assert.equal(canonicalWebsitePageUrl({ ...environment, nodeEnv: 'production' }, 'localhost:3000', '/plans'), null);
  assert.equal(canonicalWebsitePageUrl({ ...environment, origin: 'https://metro.example.invalid' }, 'localhost:3000', '/plans'), null);
});
test('canonical page navigation does not expand trusted POST origins or bypass CSRF', () => {
  assert.doesNotThrow(() => assertSameOrigin(new Headers({ origin: environment.origin, 'sec-fetch-site': 'same-origin' }), environment.origin));
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3001', 'https://evil.invalid', 'null']) {
    assert.throws(() => assertSameOrigin(new Headers({ origin }), environment.origin), { code: 'FORBIDDEN' });
  }
  assert.throws(() => assertSameOrigin(new Headers(), environment.origin), { code: 'FORBIDDEN' });
  assert.throws(() => assertSameOrigin(new Headers({ origin: environment.origin, 'sec-fetch-site': 'cross-site' }), environment.origin), { code: 'FORBIDDEN' });
});
test('proxy replaces untrusted redirect hints and never redirects or forwards a POST', () => {
  const prior = { NODE_ENV: process.env.NODE_ENV, METRO_AUTH_ENABLED: process.env.METRO_AUTH_ENABLED, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL };
  Object.assign(process.env, { NODE_ENV: 'development', METRO_AUTH_ENABLED: 'true', BETTER_AUTH_URL: environment.origin });
  try {
    const header = `x-middleware-request-${CANONICAL_NAVIGATION_HEADER}`;
    const page = proxy(new NextRequest('http://localhost:3000/plans?months=3', { headers: { host: 'localhost:3000', [CANONICAL_NAVIGATION_HEADER]: 'https://evil.invalid' } }));
    assert.equal(page.headers.get(header), `${environment.origin}/plans?months=3`);
    const post = proxy(new NextRequest('http://localhost:3000/checkout', { method: 'POST', headers: { host: 'localhost:3000', [CANONICAL_NAVIGATION_HEADER]: 'https://evil.invalid' }, body: 'private fixture' }));
    assert.equal(post.headers.get(header), null);
    assert.equal(post.headers.get('location'), null);
    const canonical = proxy(new NextRequest(environment.origin + '/plans', { headers: { host: '127.0.0.1:3000', [CANONICAL_NAVIGATION_HEADER]: 'https://evil.invalid' } }));
    assert.equal(canonical.headers.get(header), null);
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
