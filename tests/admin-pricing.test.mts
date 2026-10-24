import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { catalogSchema, calculateWebsiteQuote, defaultDurations, formatWebsiteMmk, PRICING_POLICY, publishPricingSchema } from "../src/features/pricing/catalog.ts";
import { readQuoteBody } from "../src/server/pricing/http.ts";
import { isSafeAuthCallback, safeReturnPath } from "../src/features/auth/redirects.ts";
import { assertSameOrigin, adminErrorMessage } from "../src/server/admin/request.ts";
import { redactSupportDescription } from "../src/server/admin/repository.ts";
import { assertReviewedMigrationSet } from "../scripts/foundation/verify.mjs";

const pkg={id:randomUUID(),name:"Isolated package",dataGb:50,monthlyPriceMmk:"10001",active:true};
const catalog={policy:PRICING_POLICY,packages:[pkg],durations:defaultDurations()};
const release={id:randomUUID(),version:1,createdAt:new Date().toISOString(),catalog};
test("website durations, exact 30-day months and cumulative quota",()=>{
  assert.deepEqual(defaultDurations().map(x=>x.discountPercent),[0,5,10,15,20,25,30,35,40,45,50,55]);
  for(let months=1;months<=12;months++){
    const q=calculateWebsiteQuote(release,{version:1,packageId:pkg.id,months});
    assert.equal(q.durationDays,months*30);assert.equal(q.totalDataGb,50*months);
    assert.equal(BigInt(q.quotaBytes),BigInt(50 * 1024 ** 3)*BigInt(months));
    assert.equal(BigInt(q.regularMmk),BigInt(q.savedMmk)+BigInt(q.totalMmk));
  }
});
test("independent discounts and half-up integer MMK including 100 percent",()=>{
  for(const discountPercent of [0,7,37,99,100]){
    const copy=structuredClone(release);copy.catalog.durations[1].discountPercent=discountPercent;
    const q=calculateWebsiteQuote(copy,{version:1,packageId:pkg.id,months:2});
    assert.equal(q.discountPercent,discountPercent);
    assert.equal(q.savedMmk,((BigInt(20002)*BigInt(discountPercent)+BigInt(50))/BigInt(100)).toString());
    assert.ok(BigInt(q.totalMmk)>=BigInt(0));
  }
  assert.equal(formatWebsiteMmk("999999999999999999999999"),"999,999,999,999,999,999,999,999 MMK");
});
test("stale versions, inactive packages and unavailable durations are rejected",()=>{
  const input={version:1,packageId:pkg.id,months:2};
  assert.throws(()=>calculateWebsiteQuote(release,{...input,version:2}),/PRICING_CHANGED/);
  const copy=structuredClone(release);copy.catalog.durations[1].active=false;
  assert.throws(()=>calculateWebsiteQuote(copy,input),/PLAN_UNAVAILABLE/);
  copy.catalog.durations[1].active=true;copy.catalog.packages[0].active=false;
  assert.throws(()=>calculateWebsiteQuote(copy,input),/PLAN_UNAVAILABLE/);
});
test("catalog validates whole money, package uniqueness and all twelve durations",()=>{
  assert.ok(catalogSchema.safeParse(catalog).success);
  for(const patch of [{monthlyPriceMmk:"1.5"},{monthlyPriceMmk:"-1"},{dataGb:1.2},{name:"<script>"}])assert.equal(catalogSchema.safeParse({...catalog,packages:[{...pkg,...patch}]}).success,false);
  assert.equal(catalogSchema.safeParse({...catalog,packages:[pkg,pkg]}).success,false);
  assert.equal(catalogSchema.safeParse({...catalog,durations:defaultDurations().slice(1)}).success,false);
  assert.equal(publishPricingSchema.safeParse({catalog,expectedVersion:0,requestKey:randomUUID(),ownerId:randomUUID()}).success,false);
});
test("admin callback paths stay same-origin and exact",()=>{
  assert.equal(safeReturnPath("/admin/plans"),"/admin/plans");
  assert.equal(isSafeAuthCallback("http://127.0.0.1:3000/admin","http://127.0.0.1:3000"),true);
  for(const value of ["//evil.invalid/admin","/admin/../dashboard","https://evil.invalid/admin","/admin?owner=true"])assert.equal(isSafeAuthCallback(value,"http://127.0.0.1:3000"),false);
});
test("quote input is bounded and rejects malformed or non-JSON bodies",async()=>{
  const req=(body:string,type="application/json")=>new Request("http://127.0.0.1:3000/api/pricing/quote",{method:"POST",headers:{"Content-Type":type},body});
  assert.deepEqual(await readQuoteBody(req('{"months":1}')),{months:1});
  await assert.rejects(readQuoteBody(req("x".repeat(1025))),/INVALID_REQUEST/);
  await assert.rejects(readQuoteBody(req("{")),/INVALID_REQUEST/);
  await assert.rejects(readQuoteBody(req("{}","text/plain")),/INVALID_REQUEST/);
});
test("mutation origin checks fail closed and public errors never expose internal values",()=>{
  const origin="http://127.0.0.1:3000";
  assert.doesNotThrow(()=>assertSameOrigin(new Headers({origin}),origin));
  for(const headers of [new Headers(),new Headers({origin:"https://evil.invalid"}),new Headers({origin,"sec-fetch-site":"cross-site"})])assert.throws(()=>assertSameOrigin(headers,origin));
  assert.doesNotMatch(adminErrorMessage(new Error("private database credential")),/credential|database/i);
});
test("customer-supplied support text cannot expose native keys or private URLs",()=>{
  const text=redactSupportDescription('Connection failed. ss://isolated-private-key https://private.invalid/path Bearer isolated-token');
  assert.ok(text.includes('Connection failed.'));assert.doesNotMatch(text,/ss:\/\/|https:\/\/|isolated-private-key|isolated-token/);
});
test("old production migration approvals cannot execute the new pricing migration",()=>{
  assert.throws(()=>assertReviewedMigrationSet(),/separately unapproved/);
  assert.doesNotThrow(()=>assertReviewedMigrationSet(['20261020000000_init_website_auth','20261020010000_website_owner_foundation','20261020020000_website_pricing','20261021010000_website_notifications']));
});
