import "server-only";
import { randomUUID } from "node:crypto";
import { API_VERSION, contracts, metadataSchema, ownerSchema, type Operation, type Input, type Output, type Owner, type Permission } from "./contracts";
import { websiteOwner, sameOwner, type SessionReader } from "./identity";
import { VpnServiceError } from "./errors";

export type TransportContext = Readonly<{ version: typeof API_VERSION; actor: Owner; owner: Owner; requestId: string; idempotencyKey?: string }>;
export interface MockVpnTransport {
  readonly mode: "mock";
  execute(operation: Operation, input: unknown, context: TransportContext): Promise<unknown>;
}
export type AuditEvent = Readonly<{
  version: typeof API_VERSION; requestId: string; actor: Owner; owner: Owner;
  operation: Operation; outcome: "INTENT" | "SUCCESS" | "FAILURE";
  resourceId?: string; issueId?: string; reasonCode?: string; idempotencyKey?: string;
}>;
export type AuthorizationProvider = (input: { actor: Owner; owner: Owner; permission: Permission; operation: Operation; resourceId?: string; issueId?: string; reasonCode?: string }) => Promise<boolean>;
type Dependencies = {
  mode?: "disabled" | "mock"; transport?: MockVpnTransport; readSession?: SessionReader;
  authorize?: AuthorizationProvider; audit?: (event: AuditEvent) => Promise<void>;
};

function verifyResponseOwner(data: unknown, expected: Owner, requestId: string) {
  if (!data || typeof data !== "object") return;
  if ("owner" in data) {
    const owner = ownerSchema.safeParse(data.owner);
    if (!owner.success || !sameOwner(owner.data, expected)) throw new VpnServiceError("INVALID_RESPONSE", requestId);
  }
  if ("entitlements" in data && Array.isArray(data.entitlements)) {
    for (const entitlement of data.entitlements) verifyResponseOwner(entitlement, expected, requestId);
  }
}

function verifyCorrelation(operation: Operation, input: Record<string, unknown>, data: Record<string, unknown>, requestId: string) {
  const match = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new VpnServiceError("INVALID_RESPONSE", requestId);
  };
  switch (operation) {
    case "quotes.create": match(data.packageId, input.packageId); match(data.months, input.months); match(data.catalogVersion, input.catalogVersion); break;
    case "orders.create": match(data.quoteId, input.quoteId); break;
    case "orders.get": match(data.id, input.orderId); break;
    case "payments.confirm": match(data.orderId, input.orderId); break;
    case "issues.report": match(data.entitlementId, input.entitlementId); break;
    case "issues.retry": match(data.id, input.issueId); break;
    case "diagnostics.record": match(data.id, input.issueId); match(data.entitlementId, input.entitlementId); break;
    case "diagnostics.get": match((data.entitlement as Record<string, unknown>).id, input.entitlementId); break;
    case "credentials.reveal": match(data.entitlementId, input.entitlementId); match(data.version, input.expectedVersion); break;
    case "replacements.request": match(data.entitlementId, input.entitlementId); match(data.issueId, input.issueId); match(data.expectedVersion, input.expectedVersion); break;
  }
}

export function createVpnServiceClient(dependencies: Dependencies = {}) {
  return {
    async execute<K extends Operation>(operation: K, input: Input<K>, metadata: { requestId: string; idempotencyKey?: string }): Promise<{ version: typeof API_VERSION; requestId: string; data: Output<K> }> {
      const parsedMetadata = metadataSchema.safeParse(metadata);
      const requestId = parsedMetadata.success ? parsedMetadata.data.requestId : randomUUID();
      // No environment variable can activate a network client in Step 06B.1.
      if (dependencies.mode !== "mock" || process.env.NODE_ENV === "production") throw new VpnServiceError("DISABLED", requestId);
      if (!parsedMetadata.success) throw new VpnServiceError("INVALID_REQUEST", requestId);
      if (!Object.hasOwn(contracts, operation)) throw new VpnServiceError("INVALID_REQUEST", requestId);
      const contract = contracts[operation];
      const parsed = contract.request.safeParse(input);
      if (!parsed.success || contract.mutation && !parsedMetadata.data.idempotencyKey) throw new VpnServiceError("INVALID_REQUEST", requestId);
      if (!dependencies.transport || dependencies.transport.mode !== "mock") throw new VpnServiceError("DISABLED", requestId);
      let actor: Owner;
      try { actor = Object.freeze(await websiteOwner(requestId, dependencies.readSession)); }
      catch (error) { throw error instanceof VpnServiceError ? error : new VpnServiceError("UNAVAILABLE", requestId); }
      const owner = Object.freeze("owner" in parsed.data ? ownerSchema.parse(parsed.data.owner) : actor);
      const permission = contract.permission;
      const resourceId = "entitlementId" in parsed.data ? String(parsed.data.entitlementId) : "orderId" in parsed.data ? String(parsed.data.orderId) : undefined;
      const issueId = "issueId" in parsed.data ? String(parsed.data.issueId) : undefined;
      const reasonCode = "reason" in parsed.data ? String(parsed.data.reason) : undefined;
      if (permission) {
        let permitted = false;
        try { permitted = await dependencies.authorize?.({ actor, owner, permission, operation, resourceId, issueId, reasonCode }) === true; }
        catch { /* Authorization provider failure remains a denial. */ }
        if (!permitted) throw new VpnServiceError("FORBIDDEN", requestId);
        if (!dependencies.audit) throw new VpnServiceError("AUDIT_UNAVAILABLE", requestId);
      }
      const audit = async (outcome: AuditEvent["outcome"]) => {
        if (!permission) return;
        try { await dependencies.audit!({ version: API_VERSION, requestId, actor, owner, operation, outcome,
          resourceId, issueId, reasonCode, idempotencyKey: parsedMetadata.data.idempotencyKey }); }
        catch { throw new VpnServiceError("AUDIT_UNAVAILABLE", requestId); }
      };
      await audit("INTENT");
      try {
        const raw = await dependencies.transport.execute(operation, parsed.data, Object.freeze({ version: API_VERSION, actor, owner, ...parsedMetadata.data }));
        const result = contract.response.safeParse(raw);
        if (!result.success) throw new VpnServiceError("INVALID_RESPONSE", requestId);
        verifyResponseOwner(result.data, owner, requestId);
        verifyCorrelation(operation, parsed.data, result.data, requestId);
        await audit("SUCCESS");
        return { version: API_VERSION, requestId, data: result.data as Output<K> };
      } catch (error) {
        await audit("FAILURE");
        throw new VpnServiceError(error instanceof VpnServiceError ? error.code : "UNAVAILABLE", requestId);
      }
    },
  };
}
