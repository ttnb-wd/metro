const returnPaths = new Set([
  "/", "/services", "/services/secure-access", "/plans",
  "/dashboard", "/dashboard/services", "/dashboard/secure-access", "/dashboard/orders",
  "/dashboard/billing", "/dashboard/settings", "/checkout", "/setup",
  "/admin", "/admin/customers", "/admin/plans", "/admin/discounts", "/admin/orders", "/admin/payments", "/admin/payment-approvals",
  "/admin/vpn", "/admin/support", "/admin/notifications", "/admin/reports", "/admin/settings", "/admin/audit",
]);

function checkoutPath(value: string): string | null {
  if (!value.startsWith("/checkout?") || value.length > 240 || /[%\\#\s]/.test(value)) return null;
  const query = new URLSearchParams(value.slice("/checkout?".length));
  const keys = [...query.keys()];
  if (keys.length === 1 && keys[0] === "draft" && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(query.get("draft") ?? "")) return `/checkout?draft=${query.get("draft")}`;
  if (keys.length < 3 || keys.length > 4 || new Set(keys).size !== keys.length || keys.some(key => !["package", "months", "version", "method"].includes(key))) return null;
  if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(query.get("package") ?? "")
    || !/^(?:[1-9]|1[0-2])$/.test(query.get("months") ?? "")
    || !/^[1-9][0-9]{0,9}$/.test(query.get("version") ?? "") || Number(query.get("version")) > 2_000_000_000
    || (query.has("method") && !/^[a-z][a-z0-9_-]{0,39}$/.test(query.get("method") ?? ""))) return null;
  const canonical = new URLSearchParams();
  for (const key of ["package", "months", "version", "method"]) if (query.has(key)) canonical.set(key, query.get(key)!);
  return `/checkout?${canonical}`;
}

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  if (ownedOrderPath(value)) return value;
  return returnPaths.has(value) ? value : checkoutPath(value) ?? "/dashboard";
}

function ownedOrderPath(value: string): boolean {
  return /^\/(?:checkout\/confirmation|dashboard\/orders)\/[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}(?:\/receipt)?$/i.test(value)
    && !(value.startsWith("/checkout/") && value.endsWith("/receipt"));
}

export function isSafeAuthCallback(value: unknown, origin: string): boolean {
  if (typeof value !== "string" || value.includes("\\") || value.includes("%")
    || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return false;
  const callbacks = new Set([...returnPaths, "/verify-email"]);
  if (value.startsWith("/")) return callbacks.has(value) || ownedOrderPath(value) || checkoutPath(value) === value;
  try {
    const url = new URL(value);
    const destination = `${url.pathname}${url.search}`;
    return url.origin === origin && !url.username && !url.password && !url.hash
      && (callbacks.has(destination) || ownedOrderPath(destination) || checkoutPath(destination) === destination) && value === `${origin}${destination}`;
  } catch { return false; }
}
