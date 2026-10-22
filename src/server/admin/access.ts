import "server-only";
import { z } from "zod";
import type { PrismaClient, Prisma } from "../db/generated/client";
import { authenticatedSession, FoundationError, readWebsiteSession, requireOwnerSession, type SessionReader, type VerifiedSession } from "../owner/authorization";

export type AdminContext = { tx: Prisma.TransactionClient; session: VerifiedSession; now: Date; account: { id: string; name: string; email: string } };

// Every query/action rechecks the database session and immutable singleton binding.
// Layout checks alone are deliberately insufficient.
export function buildAdminAccess(db: PrismaClient, readSession: SessionReader = readWebsiteSession) {
  return async function access<T>(work: (context: AdminContext) => Promise<T>, recent = false): Promise<T> {
    try {
      // Resolve Better Auth before holding a transaction connection. The persisted
      // session is still rechecked below; parallel admin renders cannot exhaust
      // the pool while waiting for nested authentication queries.
      const raw = await readSession();
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const [{ nowMs }] = await tx.$queryRaw<Array<{ nowMs: bigint }>>`SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS "nowMs"`;
        const now = new Date(Number(nowMs));
        if (!z.object({ user: z.object({ emailVerified: z.literal(true) }) }).safeParse(raw).success) throw new FoundationError("UNAUTHENTICATED");
        const claimed = await authenticatedSession(async () => raw, now);
        const persisted = await tx.session.findFirst({ where: { id: claimed.session.id, userId: claimed.user.id, expiresAt: { gt: now } }, select: { id: true, userId: true, createdAt: true, expiresAt: true } });
        if (!persisted) throw new FoundationError("UNAUTHENTICATED");
        const session = { user: claimed.user, session: persisted };
        const binding = await tx.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } });
        requireOwnerSession(session, binding?.userId ?? null, now, recent);
        const account = await tx.user.findFirst({ where: { id: session.user.id, emailVerified: true }, select: { id: true, name: true, email: true } });
        if (!account) throw new FoundationError("FORBIDDEN");
        return work({ tx, session, now, account });
      }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      throw new FoundationError("UNAVAILABLE");
    }
  };
}
