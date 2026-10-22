import "server-only";
import { cache } from "react";
import type { WebsiteSession } from "./index";
import { foundationDatabase } from "../website";
import { resolveAccountDestination } from "./account-routing-policy";

// Read the immutable singleton on the server; email, client roles and callback
// destinations cannot confer OWNER access. Cache only within one RSC request.
const readOwnerBinding = cache(async (): Promise<string | null> => {
  const db = await foundationDatabase();
  return (await db.ownerBinding.findUnique({ where: { slot: 1 }, select: { userId: true } }))?.userId ?? null;
});

export async function getAccountDestination(session: WebsiteSession, requested: unknown = "/dashboard"): Promise<string> {
  return resolveAccountDestination(session.user, requested, readOwnerBinding);
}
