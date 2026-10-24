import 'server-only';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateFulfilmentResult} from '../src/server/commerce/fulfilment-result';
import {productionFulfilmentWorker} from '../src/server/commerce/worker';
import type {PrismaClient} from '../src/server/db/generated/client';
// Pure release diagnostics. No database client, order, account or Outline key is
// constructed. Execute in a network-disabled container and in disabled runtime.
const now=Date.now(),userId=randomUUID(),packageId=randomUUID(),quoteId=randomUUID();
const operation={id:randomUUID(),userId,kind:'PROVISION',orderId:randomUUID(),expectedVersion:null,createdAt:new Date(now),frozenSnapshot:{id:quoteId,packageId,pricingVersion:1,months:1,durationDays:30,quotaBytes:'1073741824'}};
const entitlement={id:randomUUID(),owner:{issuer:'metro-website',subject:userId},packageId,version:0,status:'ACTIVE',keyId:'mw-'+'a'.repeat(48),keyStatus:'ENFORCED',expiresAt:new Date(now+30*86400000).toISOString(),totalBytes:'1073741824',usedBytes:'0',remainingBytes:'1073741824',usageHistoryVersion:0,observedAt:new Date(now).toISOString()};
const receipt={protocol:'metro-fulfilment-receipt.v1',operationId:operation.id,kind:'PROVISION',orderId:operation.orderId,quoteId,quoteVersion:1,appliedAt:new Date(now).toISOString(),completedAt:new Date(now).toISOString(),before:null,entitlement,purchase:{packageId,quotaBytes:'1073741824',months:1,durationDays:30},usageOffsetBytes:'0',previousUsageOffsetBytes:'0',verifiedFiniteLimitBytes:'1073741824',enforcement:{counterBytes:'0',windowBytes:'0',counterEpoch:'isolated-release-diagnostic',verifiedAt:new Date(now).toISOString()},oldKeyId:null,oldKeyRevoked:false};
assert.deepEqual(validateFulfilmentResult(receipt,operation,now),entitlement);
for(const patch of [{operationId:randomUUID()},{quoteVersion:2},{verifiedFiniteLimitBytes:'0'},{entitlement:{...entitlement,owner:{issuer:'metro-website',subject:randomUUID()}}},{entitlement:{...entitlement,expiresAt:new Date(now+86400000).toISOString()}}])assert.throws(()=>validateFulfilmentResult({...receipt,...patch},operation,now));
assert.equal((await productionFulfilmentWorker({} as PrismaClient).runOne()).status,'DISABLED');
console.log(JSON.stringify({protocol:'metro-fulfilment-receipt.v1',validAccepted:true,invalidRejected:5,actualProductionGateEnforced:true,externalEffects:0}));
