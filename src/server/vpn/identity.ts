import "server-only";
import { WEBSITE_ISSUER, ownerSchema, type Owner } from "./contracts";
import { VpnServiceError } from "./errors";

export type SessionReader = () => Promise<{ user: { id: string } } | null>;
async function readSession() {
  const { getWebsiteSession } = await import("@/server/auth/session");
  return getWebsiteSession();
}
export async function websiteOwner(requestId: string, reader: SessionReader = readSession): Promise<Owner> {
  const session = await reader();
  if (!session) throw new VpnServiceError("UNAUTHENTICATED", requestId);
  const result = ownerSchema.safeParse({ issuer: WEBSITE_ISSUER, subject: session.user.id });
  if (!result.success) throw new VpnServiceError("FORBIDDEN", requestId);
  return result.data;
}
export function sameOwner(a: Owner, b: Owner): boolean {
  return a.issuer === b.issuer && a.subject === b.subject;
}
