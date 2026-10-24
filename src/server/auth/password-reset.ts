import "server-only";
import { z } from "zod";
import { resetTokenSchema } from "../email/password-reset";

const requestSchema = z.strictObject({ email: z.email().max(254), redirectTo: z.literal("/reset-password").optional() });
const resetSchema = z.strictObject({ token: resetTokenSchema, newPassword: z.string().min(12).max(128) });

export function passwordRecoveryInput(path: string, input: unknown): Record<string, string> | null {
  if (path === "/request-password-reset") {
    const result = requestSchema.safeParse(input);
    return result.success ? { email: result.data.email.trim().toLowerCase(), redirectTo: "/reset-password" } : null;
  }
  const result = resetSchema.safeParse(input);
  return result.success ? result.data : null;
}
