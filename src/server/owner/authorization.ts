import "server-only";
import { z } from "zod";
import type { AuthorizationProvider } from "../vpn/client";

export const RECENT_AUTH_MS = 5 * 60 * 1000;
const sessionSchema = z.object({
  user: z.object({ id: z.uuid() }),
  session: z.object({ id: z.uuid(), userId: z.uuid(), createdAt: z.coerce.date(), expiresAt: z.coerce.date() }),
});
export type VerifiedSession = z.infer<typeof sessionSchema>;
export type SessionReader = () => Promise<unknown>;
export class FoundationError extends Error {
  constructor(public readonly code: "DISABLED" | "UNAUTHENTICATED" | "FORBIDDEN" | "RECENT_AUTH_REQUIRED" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE" | "INVALID_REQUEST") {
    super(`Website foundation: ${code}.`); this.name = "FoundationError";
  }
}
export async function readWebsiteSession(): Promise<unknown> {
  const { getWebsiteSession } = await import("../auth/session");
  return getWebsiteSession();
}
export async function authenticatedSession(reader: SessionReader, now: Date): Promise<VerifiedSession> {
  let raw: unknown;
  try { raw = await reader(); } catch { throw new FoundationError("UNAVAILABLE"); }
  const result = sessionSchema.safeParse(raw);
  if (!result.success || result.data.user.id !== result.data.session.userId ||
      result.data.session.expiresAt <= now || result.data.session.createdAt > now) throw new FoundationError("UNAUTHENTICATED");
  return result.data;
}
export function requireOwnerSession(session: VerifiedSession, bindingUserId: string | null, now: Date, recent = true): void {
  if (!bindingUserId || session.user.id !== bindingUserId || session.session.userId !== bindingUserId) throw new FoundationError("FORBIDDEN");
  if (session.session.expiresAt <= now || session.session.createdAt > now) throw new FoundationError("UNAUTHENTICATED");
  if (recent && now.getTime() - session.session.createdAt.getTime() >= RECENT_AUTH_MS) throw new FoundationError("RECENT_AUTH_REQUIRED");
}

// No default binding or environment email/role promotion. Persistence is explicitly injected.
export function createOwnerAuthorization(dependencies: {
  readSession?: SessionReader; readBinding?: () => Promise<string | null>; now?: () => Date;
} = {}): AuthorizationProvider {
  return async request => {
    if (!dependencies.readBinding) return false;
    try {
      const now = dependencies.now?.() ?? new Date();
      const session = await authenticatedSession(dependencies.readSession ?? readWebsiteSession, now);
      const binding = await dependencies.readBinding?.() ?? null;
      requireOwnerSession(session, binding, now);
      return request.actor.issuer === "metro-website" && request.owner.issuer === "metro-website" && request.actor.subject === session.user.id;
    } catch { return false; }
  };
}
