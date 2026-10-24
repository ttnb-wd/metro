import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import sharp from "sharp";
import { signCheckoutQuote, verifyCheckoutQuote } from "../src/server/commerce/quote.ts";
import { buildEvidenceStore, normalizeEvidence } from "../src/server/commerce/evidence-store.ts";
import { importedCatalog } from "../src/server/commerce/catalog-import.ts";
import { paymentMethods, fulfilmentEnabled } from "../src/server/commerce/config.ts";
import { defaultDurations, PRICING_POLICY, calculateWebsiteQuote } from "../src/features/pricing/catalog.ts";
import { serviceSignature } from "../src/server/vpn/transport.ts";

const user=randomUUID(),secret=randomBytes(32).toString("hex"),method=paymentMethods({})[0];
const release={id:randomUUID(),version:1,createdAt:new Date().toISOString(),catalog:{policy:PRICING_POLICY,packages:[{id:randomUUID(),name:"Isolated test package",dataGb:50,monthlyPriceMmk:"10001",active:true}],durations:defaultDurations()}};
const selection={version:1,packageId:release.catalog.packages[0].id,months:3};
test("signed checkout is bound to user, payment instructions, expiry and exact bytes",()=>{
  const now=Date.now(),signed=signCheckoutQuote(release,selection,user,method,secret,now);
  assert.equal(verifyCheckoutQuote(signed.token,user,secret,now).userId,user);
  assert.equal(signed.quote.quotaBytes,(150n*1024n**3n).toString());
  assert.equal(signed.quote.totalMmk,"27003");
  for(const args of [[signed.token,randomUUID(),secret,now],[signed.token,user,randomBytes(32).toString("hex"),now],[signed.token,user,secret,now+600000],[signed.token+"x",user,secret,now]] as const)assert.throws(()=>verifyCheckoutQuote(...args));
});
test("editable independent discounts retain integer half-up MMK and 30-day rules",()=>{
  const updated=structuredClone(release);updated.catalog.durations[2].discountPercent=17;
  const q=calculateWebsiteQuote(updated,selection);assert.equal(q.durationDays,90);assert.equal(q.savedMmk,"5101");assert.equal(q.totalMmk,"24902");
  assert.throws(()=>calculateWebsiteQuote(updated,{...selection,version:2}));
});
test("one-time import refuses stale, fractional, non-monthly or invented fallbacks",()=>{
  const source={capturedAt:new Date().toISOString(),packages:[{id:1,name:"Actual source fixture",dataGb:50,monthlyPriceMmk:"7000",durationDays:30}]};
  const catalog=importedCatalog(source);assert.equal(catalog.packages[0].monthlyPriceMmk,"7000");assert.equal(catalog.durations[11].discountPercent,55);
  assert.throws(()=>importedCatalog({...source,capturedAt:new Date(Date.now()-70000).toISOString()}));
  assert.throws(()=>importedCatalog({...source,packages:[{...source.packages[0],durationDays:31}]}));
  assert.throws(()=>importedCatalog({...source,packages:[{...source.packages[0],monthlyPriceMmk:"7.5"}]}));
});
test("private proof is decoded, normalized, encrypted and integrity checked",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"metro-evidence-test-")),store=buildEvidenceStore({directory,key:randomBytes(32)});
  try{
    const image=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).jpeg().toBuffer();
    const receipt=await store.put(image),encrypted=await readFile(join(directory,receipt.storageRef+".enc")),decoded=await store.get(receipt.storageRef,receipt.sha256);
    assert.equal(encrypted.equals(decoded),false);assert.equal((await sharp(decoded).metadata()).format,"png");
    await assert.rejects(store.get(receipt.storageRef,"0".repeat(64)));
    await assert.rejects(store.get("../../public/proof",receipt.sha256));
    await assert.rejects(normalizeEvidence(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
    await assert.rejects(normalizeEvidence(Buffer.alloc(5*1024*1024+1)));
    await store.remove(receipt.storageRef);
  }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^metro-evidence-test-/);await rm(directory,{recursive:true,force:true});}
});
test("payment configuration excludes placeholders and irreversible execution defaults off",()=>{
  assert.equal(fulfilmentEnabled({}),false);assert.equal(fulfilmentEnabled({METRO_FULFILMENT_ENABLED:"true"}),false);
  assert.deepEqual(paymentMethods({METRO_PAYMENT_METHODS_JSON:JSON.stringify([{id:"bank",name:"Bank",accountName:"YOUR_ACCOUNT_NAME",accountNumber:"YOUR_ACCOUNT_NUMBER"}])}),[]);
  assert.notEqual(serviceSignature(secret,"1000000000000",randomUUID(),"{}"),serviceSignature(secret,"1000000000001",randomUUID(),"{}"));
});
