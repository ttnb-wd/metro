import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { contracts, entitlementSchema, orderSchema, issueSchema, quoteSchema, type Operation, type Owner, type Entitlement, type Quote } from "./contracts";
import { type MockVpnTransport, type TransportContext } from "./client";
import { sameOwner } from "./identity";
import { priceQuote } from "./policy";
import { recordConnectionTest, recordCustomerRetry, assertTransition } from "./states";
import { VpnServiceError } from "./errors";

type Order = z.infer<typeof orderSchema>;
type Issue = z.infer<typeof issueSchema>;
type Fixture = { catalog: z.input<typeof contracts["catalog.get"]["response"]>; entitlements?: Entitlement[]; now: () => string };

// Explicitly injected, in-memory fixtures only. No imports of database/Outline/bot clients.
export function createMockVpnTransport(fixture: Fixture): MockVpnTransport {
  const catalog = structuredClone(contracts["catalog.get"].response.parse(fixture.catalog));
  const entitlements = (fixture.entitlements ?? []).map(item => structuredClone(entitlementSchema.parse(item)));
  const quotes = new Map<string, Quote>(); const orders = new Map<string, Order>(); const issues = new Map<string, Issue>();
  const operations = new Map<string, unknown>();
  const requests = new Map<string, { digest: string; result: Promise<unknown> }>();
  let sequence = 0;
  const nextId = () => `fixture-${++sequence}`;
  const fail = (code: ConstructorParameters<typeof VpnServiceError>[0], context: TransportContext): never => { throw new VpnServiceError(code, context.requestId); };
  function owned<T extends { owner: Owner }>(value: T | undefined, context: TransportContext): T {
    if (!value || !sameOwner(value.owner, context.owner)) return fail("NOT_FOUND", context);
    return value;
  }
  async function run(operation: Operation, input: unknown, context: TransportContext): Promise<unknown> {
    // Each branch parses its own exact command; unknown fields never reach business policy.
    switch (operation) {
      case "catalog.get": return catalog;
      case "quotes.create": {
        const p = contracts[operation].request.parse(input);
        if (p.catalogVersion !== catalog.catalogVersion) return fail("CONFLICT", context);
        const pkg = catalog.packages.find(item => item.id === p.packageId);
        if (!pkg) return fail("NOT_FOUND", context);
        const quote = priceQuote({ id: nextId(), owner: context.owner, pkg, months: p.months,
          catalogVersion: catalog.catalogVersion, validUntil: new Date(Date.parse(fixture.now()) + 600000).toISOString() });
        quotes.set(quote.id, quote); return quote;
      }
      case "orders.create": {
        const p = contracts[operation].request.parse(input);
        const quote = owned(quotes.get(p.quoteId), context);
        const prior = [...orders.values()].find(order => order.quoteId === quote.id);
        if (prior) return prior;
        if (Date.parse(quote.validUntil) <= Date.parse(fixture.now())) return fail("CONFLICT", context);
        const order = orderSchema.parse({ id: nextId(), owner: context.owner, quoteId: quote.id,
          state: "AWAITING_PAYMENT", payment: "UNVERIFIED", provisioning: "NOT_REQUESTED", totalMmk: quote.totalMmk });
        orders.set(order.id, order); return order;
      }
      case "orders.get": return owned(orders.get(contracts[operation].request.parse(input).orderId), context);
      case "entitlements.get": return { owner: context.owner, entitlements: entitlements.filter(e => sameOwner(e.owner, context.owner)) };
      case "payments.confirm": {
        const p = contracts[operation].request.parse(input); const order = owned(orders.get(p.orderId), context);
        if (order.totalMmk !== p.amountMmk) return fail("CONFLICT", context);
        const prior = operations.get(`order:${order.id}`); if (prior) return prior;
        if (operations.has(`verification:${p.verificationId}`)) return fail("CONFLICT", context);
        // Mock authority is supplied by the client authorization dependency, never form fields.
        assertTransition("payment", order.payment, "UNDER_REVIEW");
        assertTransition("payment", "UNDER_REVIEW", "CONFIRMED", { paymentAuthorityVerified: true, verificationId: p.verificationId });
        assertTransition("provisioning", order.provisioning, "QUEUED", { payment: "CONFIRMED" });
        assertTransition("order", order.state, "FULFILMENT_PENDING", { payment: "CONFIRMED" });
        const result = { owner: context.owner, operationId: nextId(), state: "QUEUED" };
        order.payment = "CONFIRMED"; order.provisioning = "QUEUED"; order.state = "FULFILMENT_PENDING";
        operations.set(`order:${order.id}`, result); operations.set(`verification:${p.verificationId}`, order.id);
        return result;
      }
      case "issues.report": {
        const p = contracts[operation].request.parse(input);
        owned(entitlements.find(e => e.id === p.entitlementId), context);
        const issue = issueSchema.parse({ id: nextId(), owner: context.owner, entitlementId: p.entitlementId,
          state: "OPEN", attempts: 0, createdAt: fixture.now() });
        issues.set(issue.id, issue); return issue;
      }
      case "issues.retry": {
        const p = contracts[operation].request.parse(input); const issue = owned(issues.get(p.issueId), context);
        try { const updated = recordCustomerRetry(issue, p.expectedAttempt, p.result); issues.set(issue.id, updated); return updated; }
        catch { return fail("CONFLICT", context); }
      }
      case "diagnostics.get": {
        const p = contracts[operation].request.parse(input); const entitlement = owned(entitlements.find(e => e.id === p.entitlementId), context);
        return { owner: context.owner, identity: context.owner, entitlement, issues: [...issues.values()].filter(issue => sameOwner(issue.owner, context.owner) && issue.entitlementId === entitlement.id), connectionTest: "NOT_TESTED" };
      }
      case "diagnostics.record": {
        const p = contracts[operation].request.parse(input); const entitlement = owned(entitlements.find(e => e.id === p.entitlementId), context);
        const issue = owned(issues.get(p.issueId), context);
        if (issue.entitlementId !== entitlement.id || entitlement.version !== p.expectedVersion) return fail("CONFLICT", context);
        if (issue.state !== "OPEN") return fail("CONFLICT", context);
        assertTransition("issue", "OPEN", "DIAGNOSING");
        const updated = recordConnectionTest({ ...issue, state: "DIAGNOSING" }, p.result);
        issues.set(issue.id, updated); return updated;
      }
      case "replacements.request": {
        const p = contracts[operation].request.parse(input); const entitlement = owned(entitlements.find(e => e.id === p.entitlementId), context);
        const issue = owned(issues.get(p.issueId), context);
        const prior = operations.get(`replacement:${entitlement.id}:${p.expectedVersion}`); if (prior) return prior;
        if (issue.entitlementId !== entitlement.id || issue.state !== "REPLACEMENT_APPROVED" || entitlement.version !== p.expectedVersion ||
            entitlement.status !== "ACTIVE" || !entitlement.keyId || BigInt(entitlement.remainingBytes) <= BigInt(0) ||
            Date.parse(entitlement.expiresAt) <= Date.parse(fixture.now())) return fail("CONFLICT", context);
        const result = { owner: context.owner, operationId: nextId(), state: "REQUESTED" };
        operations.set(`replacement:${entitlement.id}:${p.expectedVersion}`, result); return result;
      }
      case "credentials.reveal": return fail("UNAVAILABLE", context); // Never mint even a simulated credential.
    }
  }
  return { mode: "mock", async execute(operation, input, context) {
    const parsed = contracts[operation].request.parse(input);
    // Mock operation snapshots cannot be mutated by a caller after returning.
    if (!contracts[operation].mutation) return structuredClone(await run(operation, parsed, context));
    if (!context.idempotencyKey) return fail("INVALID_REQUEST", context);
    const key = JSON.stringify([context.actor.issuer, context.actor.subject, operation, context.idempotencyKey]);
    const digest = createHash("sha256").update(JSON.stringify([context.owner, parsed])).digest("hex");
    const prior = requests.get(key);
    if (prior) {
      if (prior.digest !== digest) return fail("CONFLICT", context);
      return structuredClone(await prior.result);
    }
    const result = Promise.resolve().then(() => run(operation, parsed, context)).then(value => structuredClone(value));
    requests.set(key, { digest, result });
    return structuredClone(await result);
  } };
}
