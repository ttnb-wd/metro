import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/forms/password-recovery-form";
import { canonicalizeAuthPage } from "@/server/auth/canonical-origin";

export const metadata: Metadata = { title: "Recover your account", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ForgotPasswordPage() {
  await canonicalizeAuthPage("/forgot-password", {});
  return <PasswordRecoveryForm />;
}
