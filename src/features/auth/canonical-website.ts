// Canonicalize development page navigation, never API requests or mutations.
// A loopback alias has a separate cookie jar and is not a trusted POST origin.
export const CANONICAL_NAVIGATION_HEADER = "x-metro-canonical-page";

export function canonicalWebsitePageUrl(
  environment: { origin: string; nodeEnv: string }, host: string | null, pathname: string, search = "",
): string | null {
  const configured = new URL(environment.origin);
  if (environment.nodeEnv === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)
    || host === configured.host || !pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const aliases = ["localhost", "127.0.0.1", "[::1]"].map(hostname => {
    const alias = new URL(configured); alias.hostname = hostname; return alias.host;
  });
  if (!host || !aliases.includes(host)) return null;
  configured.pathname = pathname; configured.search = search;
  return configured.href;
}
