import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms/auth-form";
import { getWebsiteSession } from "@/server/auth/session";
import { safeReturnPath } from "@/server/auth/redirects";
import { canonicalizeAuthPage } from "@/server/auth/canonical-origin";
import { getAccountDestination } from "@/server/auth/account-routing";

export const metadata: Metadata = { title: "Create account" };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  await canonicalizeAuthPage("/register", query);
  const returnTo = safeReturnPath(query.next);
  const session = await getWebsiteSession();
  if (session) redirect(await getAccountDestination(session, returnTo));
  return <AuthForm mode="register" returnTo={returnTo} />;
}
