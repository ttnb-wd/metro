import { z } from "zod";
import { randomUUID } from "node:crypto";
import { commerceRequest, commerceFailure, limitedBody } from "@/server/commerce/http";
import { buildAdminAccess } from "@/server/admin/access";
import { getWebsiteRepositories } from "@/server/website";
import { callVpnService, nativeCredentialSchema } from "@/server/vpn/transport";
import { FoundationError } from "@/server/owner/authorization";
import { entitlementSchema } from "@/server/vpn/contracts";
import { liveServiceStatus } from "@/server/vpn/live-status";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await commerceRequest(request), { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new FoundationError("NOT_FOUND");
    const parsed = z.strictObject({ admin: z.boolean().default(false) }).safeParse(JSON.parse((await limitedBody(request, 100)).toString("utf8")));
    if (!parsed.success) throw new FoundationError("INVALID_REQUEST");
    const service = parsed.data.admin ? await buildAdminAccess(db)(async ({ tx, account }) => {
      const target = await tx.websiteServiceReference.findUnique({ where: { id } });
      if (!target) throw new FoundationError("NOT_FOUND");
      await tx.websiteAuditEvent.create({ data: { actorId: account.id, targetUserId: target.userId, action: "AUDIT_READ", outcome: "SUCCESS", resourceId: `vpn-credential:${id}`, reasonCode: "OWNER_READ", requestId: randomUUID(), idempotencyKey: randomUUID() } });
      return target;
    }, true) : await (await getWebsiteRepositories()).service(id);
    const known = entitlementSchema.parse(service.snapshot);
    if (known.owner.subject !== service.userId || known.version !== service.version || known.id !== service.externalId) throw new FoundationError("CONFLICT");
    const current = await liveServiceStatus(service);
    if (!current.status.canConnect || !current.entitlement) return Response.json({ code: current.status.condition, message: current.status.reasons.join(" "), topUp: current.status.topUp, renew: current.status.renew }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    const result = nativeCredentialSchema.parse(await callVpnService("credential", { owner: { issuer: "metro-website", subject: service.userId }, entitlementId: service.externalId, expectedVersion: current.entitlement.version, audience: parsed.data.admin ? "OWNER" : "CUSTOMER" }));
    if (result.owner.subject !== service.userId || result.entitlementId !== service.externalId || result.version !== current.entitlement.version || result.keyId !== current.entitlement.keyId) throw new FoundationError("CONFLICT");
    return Response.json({ credential: result.credential }, { headers: { "Cache-Control": "private, no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return commerceFailure(error); }
}
