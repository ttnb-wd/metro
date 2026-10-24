import "server-only";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "@/server/db/generated/client";
import type { EnabledAuthEnvironment } from "@/server/env";
import { sendVerificationEmail, VERIFICATION_LIFETIME_SECONDS } from "@/server/email/verification";
import { sendPasswordResetEmail, RESET_LIFETIME_SECONDS } from "@/server/email/password-reset";

export const INTERNAL_AUTH_IP_HEADER = "x-metro-auth-ip";

export function createAuthOptions(environment: EnabledAuthEnvironment, prisma: PrismaClient,
  deliverVerification: typeof sendVerificationEmail = sendVerificationEmail,
  deliverReset: typeof sendPasswordResetEmail = sendPasswordResetEmail) {
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
      resetPasswordTokenExpiresIn: RESET_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }: { user: { email: string }; token: string }) => {
        await deliverReset({ email: user.email, token, origin: environment.origin });
      },
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
        "/request-password-reset": { window: 60, max: 1 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "metro",
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      crossSubDomainCookies: { enabled: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      database: { generateId: "uuid", validateSchema: true },
      // Server-generated, opaque per-account identity; do not aggregate its
      // bits as though it were an actual IPv6 network.
      ipAddress: { ipAddressHeaders: [INTERNAL_AUTH_IP_HEADER], ipv6Subnet: 128 },
    },
    logger: { disabled: true },
  } satisfies BetterAuthOptions;
}
