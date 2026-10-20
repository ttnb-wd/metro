import "server-only";
import { API_VERSION, type ErrorCode } from "./contracts";

const messages: Record<ErrorCode, string> = {
  DISABLED: "Service integration is not enabled.", UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "This action is not permitted.", NOT_FOUND: "The requested resource is unavailable.",
  INVALID_REQUEST: "Check the request and try again.", INVALID_RESPONSE: "Service information is temporarily unavailable.",
  CONFLICT: "The request conflicts with an existing operation. Refresh its status.",
  UNAVAILABLE: "The service is temporarily unavailable.", AUDIT_UNAVAILABLE: "This action is temporarily unavailable.",
};
export class VpnServiceError extends Error {
  constructor(public readonly code: ErrorCode, public readonly requestId: string) {
    super(messages[code]); this.name = "VpnServiceError";
  }
  publicResult() {
    return { version: API_VERSION, requestId: this.requestId, code: this.code,
      message: messages[this.code], retryable: ["UNAVAILABLE", "AUDIT_UNAVAILABLE"].includes(this.code) };
  }
}
