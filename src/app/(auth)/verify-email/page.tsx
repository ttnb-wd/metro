import type { Metadata } from "next";
import { VerificationForm } from "@/components/forms/verification-form";
import { safeReturnPath } from "@/features/auth/redirects";
import { canonicalizeAuthPage } from "@/server/auth/canonical-origin";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  await canonicalizeAuthPage("/verify-email", query);
  return <VerificationForm returnTo={safeReturnPath(query.next)} />;
}
