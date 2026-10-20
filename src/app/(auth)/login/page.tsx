import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms/auth-form";
import { getWebsiteSession } from "@/server/auth/session";
import { safeReturnPath } from "@/server/auth/redirects";
import { canonicalizeAuthPage } from "@/server/auth/canonical-origin";

export const metadata: Metadata = { title: "Log in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; registered?: string; verified?: string }> }) {
  const query = await searchParams;
  await canonicalizeAuthPage("/login", query);
  const returnTo = safeReturnPath(query.next);
  if (await getWebsiteSession()) redirect(returnTo);
  return <AuthForm mode="login" returnTo={returnTo} registered={query.registered === "1"} verified={query.verified === "1"} />;
}
