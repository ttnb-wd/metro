import "server-only";
import { randomUUID } from "node:crypto";

export type SecurityEvent = "AUTH_DENIED" | "AUTH_RATE_LIMITED" | "AUTH_SOURCE_UNAVAILABLE" | "OWNER_DENIED" | "EVIDENCE_ORPHAN_REVIEW";
/** Fixed event codes only. Never accept request bodies, identities, URLs or errors. */
export function securityDiagnostic(event: SecurityEvent) {
  console.warn(JSON.stringify({ component: "metro-security", event, eventId: randomUUID() }));
}
