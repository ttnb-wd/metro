const returnPaths = new Set([
  "/", "/services", "/services/secure-access", "/plans",
  "/dashboard", "/dashboard/services", "/dashboard/secure-access", "/dashboard/orders",
  "/dashboard/billing", "/dashboard/settings", "/checkout", "/setup",
]);

export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && returnPaths.has(value) ? value : "/dashboard";
}

export function isSafeAuthCallback(value: unknown, origin: string): boolean {
  if (typeof value !== "string" || value.includes("\\") || value.includes("%")
    || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return false;
  if (value.startsWith("/")) return returnPaths.has(value);
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      && returnPaths.has(url.pathname) && value === `${origin}${url.pathname}`;
  } catch { return false; }
}
