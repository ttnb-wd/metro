import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { formatMyanmarTime, MYANMAR_TIME_ZONE } from '../src/lib/myanmar-time.ts';
import { receiptDocument, receiptPaymentLabel, type OrderReceipt } from '../src/features/pricing/receipt.ts';
import { safeReturnPath, isSafeAuthCallback } from '../src/features/auth/redirects.ts';
import { liveServiceStatus } from '../src/server/vpn/live-status.ts';
import type { Entitlement } from '../src/server/vpn/contracts.ts';

test('Myanmar formatting rolls over the calendar without changing UTC instants', () => {
  const instant = new Date('2026-10-21T18:00:00.000Z'), original = instant.getTime();
  assert.equal(MYANMAR_TIME_ZONE, 'Asia/Yangon');
  assert.equal(formatMyanmarTime(instant), '22 Oct 2026, 00:30:00 · Myanmar time (UTC+06:30)');
  assert.equal(instant.getTime(), original);
  assert.equal(formatMyanmarTime('invalid'), 'Not recorded');
  assert.equal(formatMyanmarTime(null), 'Not recorded');
});
test('receipt preserves whole-MMK historical values, escapes customer content and distinguishes review from confirmation', () => {
  const receipt: OrderReceipt = { id: randomUUID(), customer: { name: '<script>unsafe</script>', email: 'fixture@example.invalid' }, payment: 'UNDER_REVIEW', provisioning: 'NOT_REQUESTED', state: 'AWAITING_PAYMENT',
    plan: { packageName: 'Fixture', durationDays: 90, totalDataGb: 6, monthlyPriceMmk: '10001', regularMmk: '30003', savedMmk: '3000', discountPercent: 10, totalMmk: '27003', paymentMethod: { name: 'KBZPay (KPay)', accountName: 'Fixture', accountNumber: 'TEST' } },
    createdAt: '2026-10-21T12:00:00Z', submittedAt: '2026-10-21T18:00:00Z', latestSubmissionAt: '2026-10-21T18:00:00Z', approvedAt: null, activationRecordedAt: null, currentExpiry: null, expiryObservedAt: null };
  const pending = receiptDocument(receipt);
  for (const value of ['Payment Under Review', '27,003 MMK', '30,003 MMK', '90 days', '6 GB', '22 Oct 2026, 00:30:00', '&lt;script&gt;', 'not a KBZPay-issued receipt']) assert.ok(pending.includes(value), value);
  assert.ok(!pending.includes('<script>')); assert.ok(!pending.includes('Payment Confirmed'));
  assert.ok(!pending.includes('Paid')); assert.ok(!pending.includes('ss://'));
  assert.equal(receiptPaymentLabel('REJECTED'), 'Payment Proof Rejected');
  const approved = receiptDocument({ ...receipt, payment: 'CONFIRMED', state: 'FULFILMENT_PENDING', provisioning: 'QUEUED', approvedAt: '2026-10-21T18:10:00Z' });
  assert.ok(approved.includes('Payment Confirmed')); assert.ok(approved.includes('activation queued')); assert.ok(!approved.includes('VPN activation completed'));
});
test('order and receipt login returns allow only exact owned-resource routes', () => {
  const id = randomUUID();
  for (const path of [`/checkout/confirmation/${id}`, `/dashboard/orders/${id}`, `/dashboard/orders/${id}/receipt`]) {
    assert.equal(safeReturnPath(path), path); assert.equal(isSafeAuthCallback(path, 'https://metro.example'), true);
  }
  for (const path of [`/checkout/confirmation/${id}/receipt`, `/dashboard/orders/${id}?owner=true`, `/dashboard/orders/${id}/receipt/extra`, '/dashboard/orders/not-an-id/receipt', `//evil.invalid/dashboard/orders/${id}/receipt`]) assert.equal(safeReturnPath(path), '/dashboard');
});
test('live usage never rolls back lifetime consumption and retains only an owned last-observed timestamp on failure', async () => {
  const now = Date.now(), userId = randomUUID(), id = randomUUID();
  const saved: Entitlement = { id, owner: { issuer: 'metro-website', subject: userId }, packageId: randomUUID(), version: 2, status: 'ACTIVE', keyId: 'fixture-key', keyStatus: 'ENFORCED', expiresAt: new Date(now + 86400000).toISOString(), totalBytes: '1000', usedBytes: '400', remainingBytes: '600', usageHistoryVersion: 2, observedAt: new Date(now - 200000).toISOString() };
  const reference = { userId, externalId: id, version: 2, snapshot: saved };
  const rollback = await liveServiceStatus(reference, async () => ({ ...saved, version: 3, usedBytes: '300', remainingBytes: '700', observedAt: new Date(now).toISOString() }), now);
  assert.equal(rollback.status.usageKnown, false); assert.equal(rollback.status.usedBytes, null); assert.equal(rollback.lastObservedAt, saved.observedAt);
  const foreign = await liveServiceStatus({ ...reference, snapshot: { ...saved, owner: { issuer: 'metro-website', subject: randomUUID() } } }, async () => { throw Error('unavailable'); }, now);
  assert.equal(foreign.lastObservedAt, null);
  const fresh = await liveServiceStatus(reference, async () => ({ ...saved, observedAt: new Date(now).toISOString() }), now);
  assert.equal(fresh.status.usageKnown, true); assert.equal(fresh.status.usedBytes, '400');
});
