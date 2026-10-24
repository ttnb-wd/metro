import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { site } from "@/config/site";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CANONICAL_NAVIGATION_HEADER, canonicalWebsitePageUrl } from "@/features/auth/canonical-website";

export const metadata: Metadata = {
  title: { default: "Metro — Your digital essentials", template: "%s | Metro" },
  description: site.description,
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const candidate = requestHeaders.get(CANONICAL_NAVIGATION_HEADER);
  if (candidate && process.env.METRO_AUTH_ENABLED === "true" && process.env.BETTER_AUTH_URL) {
    let target: URL | undefined;
    try { target = new URL(candidate); } catch { /* Ignore malformed, untrusted headers. */ }
    if (target && candidate === canonicalWebsitePageUrl({ origin: process.env.BETTER_AUTH_URL, nodeEnv: process.env.NODE_ENV ?? "development" }, requestHeaders.get("host"), target.pathname, target.search)) redirect(candidate);
  }
  return <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning><body><ThemeProvider nonce={requestHeaders.get("x-metro-csp-nonce") ?? undefined}>{children}</ThemeProvider></body></html>;
}
