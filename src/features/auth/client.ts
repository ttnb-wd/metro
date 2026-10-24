"use client";

export async function submitAuth(path: "sign-in/email" | "sign-up/email" | "sign-out" | "send-verification-email" | "update-user" | "request-password-reset" | "reset-password", body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error" });
    if (response.ok) return null;
    if (response.status === 429) return "Too many attempts. Please wait a minute and try again.";
    if (response.status === 401) return path === "update-user" ? "Sign in with a verified account before changing your name." : "Email or password is incorrect.";
    if (response.status === 403) {
      const result: unknown = await response.json().catch(() => null);
      if (result && typeof result === "object" && (result as { error?: { code?: string } }).error?.code === "RECENT_AUTH_REQUIRED") return "Log out and sign in again before changing your name.";
      if (result && typeof result === "object" && (result as { error?: { code?: string } }).error?.code === "EMAIL_NOT_VERIFIED") {
        return "Verify your email before signing in. Request a new verification email below if needed.";
      }
      return "This sign-in page is out of date. Reload the page and try again.";
    }
    if (response.status === 503) return "This service is temporarily unavailable. Please try again shortly.";
    if (path === "reset-password" && response.status === 400) return "This reset link is invalid or expired. Request a new link and use a password with 12–128 characters.";
    return "We could not complete this request. Check your details and try again.";
  } catch { return "We could not reach Metro. Check your connection and try again."; }
}
