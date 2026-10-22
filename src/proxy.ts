import { NextResponse, type NextRequest } from "next/server";
import { canonicalWebsitePageUrl, CANONICAL_NAVIGATION_HEADER } from "@/features/auth/canonical-website";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(CANONICAL_NAVIGATION_HEADER);
  const destination = ["GET", "HEAD"].includes(request.method) && process.env.METRO_AUTH_ENABLED === "true" && process.env.BETTER_AUTH_URL ? canonicalWebsitePageUrl(
    { origin: process.env.BETTER_AUTH_URL, nodeEnv: process.env.NODE_ENV ?? "development" },
    request.headers.get("host"), request.nextUrl.pathname, request.nextUrl.search,
  ) : null;
  // Let the server layout issue the absolute redirect. Next's proxy adapter
  // normalizes both loopback hosts and can turn its redirect into a relative loop.
  if (destination) headers.set(CANONICAL_NAVIGATION_HEADER, destination);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/", "/services/:path*", "/plans", "/checkout/:path*", "/setup", "/dashboard/:path*", "/admin/:path*", "/login", "/register", "/verify-email", "/account/:path*"],
};
