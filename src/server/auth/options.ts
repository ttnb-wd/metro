import "server-only";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "@/server/db/generated/client";
import type { EnabledAuthEnvironment } from "@/server/env";
import { sendVerificationEmail, VERIFICATION_LIFETIME_SECONDS } from "@/server/email/verification";

export const INTERNAL_AUTH_IP_HEADER = "x-metro-auth-ip";

export function createAuthOptions(environment: EnabledAuthEnvironment, prisma: PrismaClient,
  deliverVerification: typeof sendVerificationEmail = sendVerificationEmail) {
  const secure = environment.origin.startsWith("https://");
  return {
    appName: "Metro",
    baseURL: environment.origin,
    basePath: "/api/auth",
    secret: environment.secret,
    trustedOrigins: [environment.origin],
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      // No custom password implementation: retain Better Auth's salted scrypt.
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_LIFETIME_SECONDS,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await deliverVerification({ email: user.email, url, origin: environment.origin });
      },
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/change-password": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 1 },
        "/verify-email": { window: 60, max: 10 },
        "/update-user": { window: 60, max: 5 },
      },
    },
    // Account recovery remains outside this step.
    disabledPaths: ["/request-password-reset", "/reset-password"],
    advanced: {
      cookiePrefix: "metro",
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      crossSubDomainCookies: { enabled: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      database: { generateId: "uuid", validateSchema: true },
      // The route overwrites this internal header; arbitrary forwarded IPs
      // are never trusted. Without an explicitly reviewed proxy, use one
      // conservative shared rate-limit bucket instead of a spoofable IP.
      ipAddress: { ipAddressHeaders: [INTERNAL_AUTH_IP_HEADER], ipv6Subnet: 64 },
    },
    logger: { disabled: true },
  } satisfies BetterAuthOptions;
}
