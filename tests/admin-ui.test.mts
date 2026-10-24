import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { AdminShell } from "../src/components/admin/admin-shell.tsx";
import { AdminRecords } from "../src/components/admin/admin-views.tsx";
import { PricingCalculator } from "../src/components/plans/pricing-calculator.tsx";
import { adminSections } from "../src/config/admin.ts";
let attempts=0;const guard=mock.method(net.Socket.prototype,"connect",()=>{attempts++;throw new Error("No network in isolated UI tests.");});
after(()=>{guard.mock.restore();assert.equal(attempts,0);});
const router={push(){},replace(){},refresh(){},back(){},forward(){},prefetch(){}};
function render(content:React.ReactNode,path="/admin/orders"){return renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(PathnameContext.Provider,{value:path},content)));}
test("separate admin shell includes every route, navigation landmarks and an active indicator",()=>{
  const html=render(React.createElement(AdminShell,{account:{name:"Admin fixture",email:"fixture@example.invalid"}},React.createElement("h1",null,"Fixture")));
  assert.equal(adminSections.length,12);assert.equal((html.match(/<main\b/g)??[]).length,1);
  for(const section of adminSections)assert.ok(html.includes(section.slug?`href="/admin/${section.slug}"`:'href="/admin"'));
  assert.ok((html.match(/<a\b[^>]*>/g)??[]).some(tag=>tag.includes('href="/admin/orders"')&&tag.includes('aria-current="page"')));assert.ok(html.includes("Open administration navigation"));
  assert.ok(!html.includes("split-dock"));assert.ok(!html.includes("PERSONAL WORKSPACE"));
});
test("record tables have semantic headers, labelled search and truthful empty states",()=>{
  const html=render(React.createElement(AdminRecords,{title:"Orders",data:{columns:["Order","Customer"],rows:[],total:0,page:1,pageSize:25,query:""}}));
  assert.ok(html.includes("Nothing here yet."));assert.ok(html.includes("Search by customer name or email"));assert.ok(!html.includes("fixture-order"));
  const table=render(React.createElement(AdminRecords,{title:"Customers",data:{columns:["Customer","Email"],rows:[{id:"fixture",cells:["<script>isolated</script>","fixture@example.invalid"]}],total:1,page:1,pageSize:25,query:""}}));
  assert.ok(table.includes('scope="col"'));assert.ok(table.includes('data-label="Customer"'));assert.ok(table.includes("&lt;script&gt;"));assert.ok(!table.includes("<script>isolated"));
});
test("no published pricing renders no development offers or working payment action",()=>{
  for(const status of ["UNPUBLISHED","MIGRATION_PENDING","UNAVAILABLE"] as const){
    const html=render(React.createElement(PricingCalculator,{state:{status}}),"/plans");
    assert.ok(html.includes("Website packages are being prepared."));assert.ok(!html.includes("10,000"));assert.ok(!html.includes("example-50gb"));
  }
});
