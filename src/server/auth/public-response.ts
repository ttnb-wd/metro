import "server-only";

export function publicAuthPayload(path: string, status: number, body: unknown): unknown {
  if (status >= 400) {
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
