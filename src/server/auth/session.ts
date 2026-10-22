import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthUnavailableError, getAuth, type WebsiteSession } from "@/server/auth";
import { readServerEnvironment } from "@/server/env";
import { safeReturnPath } from "@/server/auth/redirects";
import { assertWebsiteDatabaseReady } from "@/server/db/verify-target";
import { getAccountDestination } from "./account-routing";

// React cache is request-scoped, never a global user/session cache.
export const getWebsiteSession = cache(async (): Promise<WebsiteSession | null> => {
  const environment = readServerEnvironment();
  if (!environment.enabled) return null;
  try {
    await assertWebsiteDatabaseReady(environment);
    return await getAuth().api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  } catch {
    throw new AuthUnavailableError();
  }
});

export async function requireWebsiteSession(returnTo: unknown = "/dashboard"): Promise<WebsiteSession> {
  if (!readServerEnvironment().enabled) throw new AuthUnavailableError();
  const session = await getWebsiteSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(safeReturnPath(returnTo))}`);
  const destination = safeReturnPath(returnTo);
  if ((destination === "/dashboard" || destination.startsWith("/dashboard/"))
    && await getAccountDestination(session, destination) === "/admin") redirect("/admin");
  return session;
}

export async function requireWebsiteUserId(): Promise<string> {
  return (await requireWebsiteSession()).user.id;
}

// Use inside the future Prisma WHERE clause; never accept this ID from a form.
export async function websiteUserScope(): Promise<{ userId: string }> {
  return { userId: await requireWebsiteUserId() };
}

export async function requireWebsiteResourceOwner(ownerUserId: string): Promise<void> {
  if (ownerUserId !== await requireWebsiteUserId()) notFound();
}
