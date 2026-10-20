import "server-only";
import { betterAuth } from "better-auth";
import { getPrisma } from "@/server/db/client";
import { readServerEnvironment } from "@/server/env";
import { createAuthOptions } from "@/server/auth/options";

export class AuthUnavailableError extends Error {
  constructor() {
    super("Metro authentication is not available.");
    this.name = "AuthUnavailableError";
  }
}

function createAuth() {
  const environment = readServerEnvironment();
  if (!environment.enabled) throw new AuthUnavailableError();
  return betterAuth(createAuthOptions(environment, getPrisma(environment)));
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  // Check the latch before returning any previously initialized instance.
  if (!readServerEnvironment().enabled) throw new AuthUnavailableError();
  instance ??= createAuth();
  return instance;
}

export type WebsiteSession = ReturnType<typeof getAuth>["$Infer"]["Session"];
