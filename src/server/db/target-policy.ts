// Non-secret target metadata shared by the server guard and offline operator tooling.
// No connection, environment loading or credentials exist in this module.
export const WEBSITE_DATABASE = "neondb";
export const WEBSITE_DIRECT_HOST = "ep-floral-lab-azihv1v9.c-3.ap-southeast-1.aws.neon.tech";
export const WEBSITE_ROLES = { runtime: "metro_runtime", migration: "metro_migrator", assignment: "metro_owner_assign" } as const;
export const AUTH_TABLES = ["metro_account", "metro_rate_limit", "metro_session", "metro_user", "metro_verification"];
export const FOUNDATION_TABLES = ["metro_owner_binding", "metro_website_order", "metro_payment_evidence", "metro_payment_decision",
  "metro_service_reference", "metro_support_issue", "metro_issue_event", "metro_owner_audit", "metro_website_request", "metro_website_operation", "metro_website_outbox"];

export function assertWebsiteTargetUrl(value: string, role: string, pooled: boolean): URL {
  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || url.hostname !== (pooled ? WEBSITE_DIRECT_HOST.replace(".", "-pooler.") : WEBSITE_DIRECT_HOST)
      || (url.port && url.port !== "5432") || decodeURIComponent(url.pathname.slice(1)) !== WEBSITE_DATABASE
      || decodeURIComponent(url.username) !== role || !url.password || url.hash
      || url.searchParams.getAll("sslmode").length !== 1 || url.searchParams.get("sslmode") !== "verify-full"
      || url.searchParams.getAll("channel_binding").length > 1
      || ![null, "prefer", "require"].includes(url.searchParams.get("channel_binding"))
      || [...url.searchParams.keys()].some(key => !["sslmode", "channel_binding", "application_name"].includes(key))) throw new Error();
    return url;
  } catch { throw new Error("Metro website database target is not approved."); }
}
