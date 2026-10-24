import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/forms/password-recovery-form";
import { canonicalizeAuthPage } from "@/server/auth/canonical-origin";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ResetPasswordPage() {
  await canonicalizeAuthPage("/reset-password", {});
  return <PasswordRecoveryForm reset />;
}
