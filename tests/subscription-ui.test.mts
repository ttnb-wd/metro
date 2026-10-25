import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usagePresentation } from "../src/features/workspace/usage-presentation.ts";
import { serviceStatus, formatRemaining } from "../src/features/workspace/service-status.ts";
import { ServiceSubscriptionCard } from "../src/components/commerce/service-subscription-card.tsx";
import type { Entitlement } from "../src/server/vpn/contracts.ts";
const now=Date.parse('2026-10-24T10:00:00Z');
const data: Entitlement={id:'00000000-0000-4000-8000-000000000001',owner:{issuer:'metro-website',subject:'00000000-0000-4000-8000-000000000002'},packageId:'00000000-0000-4000-8000-000000000003',version:0,status:'ACTIVE',keyId:'private-key-id-not-for-rendering',keyStatus:'ENFORCED',expiresAt:new Date(now+30*86400000).toISOString(),totalBytes:'107374182400',usedBytes:'1',remainingBytes:'107374182399',usageHistoryVersion:0,observedAt:new Date(now).toISOString()};
test('tiny nonzero consumption remains visible without changing quota arithmetic',()=>{
 assert.equal(formatRemaining('1'),'1 bytes (less than 0.01 MB)');
 const usage=usagePresentation('1',data.totalBytes)!;assert.ok(usage.value>0);assert.equal(usage.label,'<0.01%');
 assert.equal(usagePresentation('0',data.totalBytes)?.label,'0.00%');
 assert.equal(usagePresentation(null,data.totalBytes),null);assert.equal(usagePresentation('1','0'),null);
 assert.equal(usagePresentation('200','100')?.value,100);
});
test('subscription display preserves exact expiry, Myanmar time and private key hiding',()=>{
 const html=renderToStaticMarkup(createElement(ServiceSubscriptionCard,{id:data.id,name:'Basic',data,status:serviceStatus(data,now),lastObservedAt:data.observedAt!,now}));
 for(const value of ['100 GB','1 bytes','30','23 Nov 2026','16:30:00','UTC+06:30','&lt;0.01%'])assert.ok(html.includes(value),value);
 assert.ok(html.includes(`dateTime="${data.expiresAt}"`));assert.ok(!html.includes(data.keyId));assert.ok(!html.includes('ss://'));
});
test('an unavailable observation does not turn saved consumption into current zero usage',()=>{
 const status=serviceStatus(null,now,false);assert.equal(status.canConnect,false);
 const html=renderToStaticMarkup(createElement(ServiceSubscriptionCard,{id:data.id,name:'Basic',data,status,lastObservedAt:data.observedAt!,now}));
 for(const value of ['Status unavailable','Unavailable','Last recorded expiry','Recorded allowance','Last verified observation'])assert.ok(html.includes(value),value);
 assert.ok(!html.includes('<progress'));assert.ok(!html.includes('0.00%'));
});
