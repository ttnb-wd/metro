import "server-only";
import { z } from "zod";
import { RECENT_AUTH_MS } from "../owner/authorization";

const profileSchema = z.strictObject({ name: z.string().trim().min(1).max(80).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)) });
export function profileNameInput(input: unknown): { name: string } | null {
  const parsed = profileSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function profileSessionError(input: unknown, now = new Date()): "UNAUTHENTICATED" | "RECENT_AUTH_REQUIRED" | null {
  const result = z.object({ user: z.object({ id: z.uuid(), emailVerified: z.literal(true) }),
    session: z.object({ userId: z.uuid(), createdAt: z.coerce.date(), expiresAt: z.coerce.date() }) }).safeParse(input);
  if (!result.success || result.data.user.id !== result.data.session.userId || result.data.session.expiresAt <= now) return "UNAUTHENTICATED";
  const age = now.getTime() - result.data.session.createdAt.getTime();
  return age < 0 || age >= RECENT_AUTH_MS ? "RECENT_AUTH_REQUIRED" : null;
}
