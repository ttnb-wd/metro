import "server-only";

export function publicAuthPayload(path: string, status: number, body: unknown): unknown {
  if (status >= 400) {
    if (path === "/reset-password" && status === 400) return { error: { code: "INVALID_RESET_LINK", message: "This reset link is invalid or expired. Request a new link and use a password with 12–128 characters." } };
    const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
    if (path === "/sign-in/email" && status === 403 && code === "EMAIL_NOT_VERIFIED") {
      return { error: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email before signing in. You can request a new verification email." } };
    }
    if (path === "/verify-email" && status !== 429 && status < 500) {
      return { error: { code: code === "TOKEN_EXPIRED" ? "VERIFICATION_EXPIRED" : "INVALID_VERIFICATION_LINK",
        message: code === "TOKEN_EXPIRED" ? "This verification link has expired. Request a new email."
          : "This verification link is invalid. Request a new email." } };
    }
    return { error: { code: status === 429 ? "RATE_LIMITED" : status === 401 ? "INVALID_CREDENTIALS" : "AUTH_REQUEST_FAILED",
      message: status === 429 ? "Too many attempts. Please wait a minute and try again."
        : status === 401 ? "Email or password is incorrect." : "We could not complete this request. Please try again." } };
  }
  if (path !== "/get-session") return { success: true };
  if (!body || typeof body !== "object") return null;
  const data = body as { user?: Record<string, unknown>; session?: Record<string, unknown> };
  if (!data.user || !data.session) return null;
  return { user: { id: data.user.id, name: data.user.name, email: data.user.email, emailVerified: data.user.emailVerified },
    session: { expiresAt: data.session.expiresAt } };
}
