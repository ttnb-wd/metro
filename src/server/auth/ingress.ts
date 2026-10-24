import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { EnabledAuthEnvironment } from "../env";

export function verifiedProxyRequest(request: Request, environment: EnabledAuthEnvironment): boolean {
  if (environment.platform === "vercel" || environment.nodeEnv !== "production" || !environment.proxySecret) return false;
  const presented = request.headers.get("x-metro-proxy-token");
  if (!presented || !/^[a-f0-9]{64,128}$/i.test(presented)) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const origin = new URL(environment.origin);
  return timingSafeEqual(digest(presented), digest(environment.proxySecret))
    && origin.protocol === "https:" && request.headers.get("host") === origin.host
    && request.headers.get("x-forwarded-proto") === "https";
}

export function trustedIngressIp(request: Request, environment: EnabledAuthEnvironment): string | undefined {
  if (environment.platform !== "vercel" && !verifiedProxyRequest(request, environment)) return undefined;
  const value = request.headers.get("x-real-ip")?.trim();
  return value && isIP(value) ? value : undefined;
}
