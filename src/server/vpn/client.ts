import "server-only";
import { randomUUID } from "node:crypto";
import { API_VERSION, contracts, metadataSchema, ownerSchema, type Operation, type Input, type Output, type Owner, type Permission } from "./contracts";
import { websiteOwner, sameOwner, type SessionReader } from "./identity";
import { VpnServiceError } from "./errors";

export type TransportContext = Readonly<{ actor: Owner; owner: Owner; requestId: string; idempotencyKey?: string }>;
export interface MockVpnTransport {
  readonly mode: "mock";
  execute(operation: Operation, input: unknown, context: TransportContext): Promise<unknown>;
}
export type AuditEvent = Readonly<{
  version: typeof API_VERSION; requestId: string; actor: Owner; owner: Owner;
  operation: Operation; outcome: "INTENT" | "SUCCESS" | "FAILURE";
}>;
export type AuthorizationProvider = (input: { actor: Owner; owner: Owner; permission: Permission; operation: Operation; resourceId?: string }) => Promise<boolean>;
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

export function createVpnServiceClient(dependencies: Dependencies = {}) {
  return {
    async execute<K extends Operation>(operation: K, input: Input<K>, metadata: { requestId: string; idempotencyKey?: string }): Promise<{ version: typeof API_VERSION; requestId: string; data: Output<K> }> {
      const parsedMetadata = metadataSchema.safeParse(metadata);
      const requestId = parsedMetadata.success ? parsedMetadata.data.requestId : randomUUID();
      // No environment variable can activate a network client in Step 06B.1.
      if (dependencies.mode !== "mock" || process.env.NODE_ENV === "production") throw new VpnServiceError("DISABLED", requestId);
      if (!parsedMetadata.success) throw new VpnServiceError("INVALID_REQUEST", requestId);
      const contract = contracts[operation];
      if (!contract) throw new VpnServiceError("INVALID_REQUEST", requestId);
      const parsed = contract.request.safeParse(input);
      if (!parsed.success || contract.mutation && !parsedMetadata.data.idempotencyKey) throw new VpnServiceError("INVALID_REQUEST", requestId);
      if (!dependencies.transport || dependencies.transport.mode !== "mock") throw new VpnServiceError("DISABLED", requestId);
      let actor: Owner;
      try { actor = Object.freeze(await websiteOwner(requestId, dependencies.readSession)); }
      catch (error) { throw error instanceof VpnServiceError ? error : new VpnServiceError("UNAVAILABLE", requestId); }
      const owner = Object.freeze("owner" in parsed.data ? ownerSchema.parse(parsed.data.owner) : actor);
      const permission = contract.permission;
      if (permission) {
        let permitted = false;
        try { permitted = await dependencies.authorize?.({ actor, owner, permission, operation,
          resourceId: "entitlementId" in parsed.data ? String(parsed.data.entitlementId) : "orderId" in parsed.data ? String(parsed.data.orderId) : undefined }) === true; }
        catch { /* Authorization provider failure remains a denial. */ }
        if (!permitted) throw new VpnServiceError("FORBIDDEN", requestId);
        if (!dependencies.audit) throw new VpnServiceError("AUDIT_UNAVAILABLE", requestId);
      }
      const audit = async (outcome: AuditEvent["outcome"]) => {
        if (!permission) return;
        try { await dependencies.audit!({ version: API_VERSION, requestId, actor, owner, operation, outcome }); }
        catch { throw new VpnServiceError("AUDIT_UNAVAILABLE", requestId); }
      };
      await audit("INTENT");
      try {
        const raw = await dependencies.transport.execute(operation, parsed.data, Object.freeze({ actor, owner, ...parsedMetadata.data }));
        const result = contract.response.safeParse(raw);
        if (!result.success) throw new VpnServiceError("INVALID_RESPONSE", requestId);
        verifyResponseOwner(result.data, owner, requestId);
        await audit("SUCCESS");
        return { version: API_VERSION, requestId, data: result.data as Output<K> };
      } catch (error) {
        await audit("FAILURE");
        throw new VpnServiceError(error instanceof VpnServiceError ? error.code : "UNAVAILABLE", requestId);
      }
    },
  };
}
