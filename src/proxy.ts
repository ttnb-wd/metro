import { NextResponse, type NextRequest } from "next/server";
import { canonicalWebsitePageUrl, CANONICAL_NAVIGATION_HEADER } from "@/features/auth/canonical-website";
import { contentSecurityPolicy } from "./security-headers";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production", process.env.NODE_ENV === "production" && process.env.BETTER_AUTH_URL?.startsWith("https://") === true);
  headers.set("x-metro-csp-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  headers.delete(CANONICAL_NAVIGATION_HEADER);
  const destination = ["GET", "HEAD"].includes(request.method) && process.env.METRO_AUTH_ENABLED === "true" && process.env.BETTER_AUTH_URL ? canonicalWebsitePageUrl(
    { origin: process.env.BETTER_AUTH_URL, nodeEnv: process.env.NODE_ENV ?? "development" },
    request.headers.get("host"), request.nextUrl.pathname, request.nextUrl.search,
  ) : null;
  // Let the server layout issue the absolute redirect. Next's proxy adapter
  // normalizes both loopback hosts and can turn its redirect into a relative loop.
  if (destination) headers.set(CANONICAL_NAVIGATION_HEADER, destination);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/", "/services/:path*", "/plans", "/checkout/:path*", "/setup", "/dashboard/:path*", "/admin/:path*", "/login", "/register", "/verify-email", "/account/:path*"],
};
