import "server-only";
import { readServerEnvironment } from "../env";
import { FoundationError } from "../owner/authorization";

export function assertAdminOrigin(requestHeaders: Headers) {
  const env = readServerEnvironment();
  if (!env.enabled) throw new FoundationError("DISABLED");
  assertSameOrigin(requestHeaders, env.origin);
}

export function assertSameOrigin(requestHeaders: Headers, origin: string) {
  if (requestHeaders.get("origin") !== origin || requestHeaders.get("sec-fetch-site") === "cross-site") throw new FoundationError("FORBIDDEN");
}

export function adminErrorMessage(error: unknown): string {
  if (error instanceof FoundationError) {
    switch (error.code) {
      case "UNAUTHENTICATED": return "Please sign in to your verified OWNER account.";
      case "RECENT_AUTH_REQUIRED": return "For your security, sign out and sign in again, then retry within five minutes.";
      case "FORBIDDEN": return "This operation is available only to the verified website OWNER.";
      case "INVALID_REQUEST": return "Check the form values and try again. Use whole MMK amounts and valid durations.";
      case "CONFLICT": return "This record changed or this request was already used. Refresh and review the latest version before saving.";
      case "NOT_FOUND": return "That website record is no longer available.";
    }
  }
  return "This operation is currently unavailable. Please retry after the website configuration is ready.";
}
