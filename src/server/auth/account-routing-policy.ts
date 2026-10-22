import "server-only";
import { z } from "zod";
import { AuthUnavailableError } from "./index";
import { safeReturnPath } from "@/features/auth/redirects";
import { FoundationError } from "../owner/authorization";

type BindingReader = () => Promise<string | null>;
const identitySchema = z.object({ id: z.uuid(), emailVerified: z.boolean() });

export async function resolveAccountDestination(user: unknown, requested: unknown, readBinding: BindingReader): Promise<string> {
  const identity = identitySchema.safeParse(user);
  if (!identity.success) throw new FoundationError("UNAUTHENTICATED");
  let binding: string | null;
  try {
    binding = await readBinding();
    if (binding !== null && !z.uuid().safeParse(binding).success) throw new Error();
  } catch { throw new AuthUnavailableError(); }
  if (binding === identity.data.id) {
    if (!identity.data.emailVerified) throw new FoundationError("FORBIDDEN");
    return "/admin";
  }
  const destination = safeReturnPath(requested);
  return destination === "/admin" || destination.startsWith("/admin/") ? "/dashboard" : destination;
}
