import "server-only";
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { readServerEnvironment } from "@/server/env";
import { AuthRequestError, prepareAuthRequest } from "@/server/auth/request-policy";
import { assertWebsiteDatabaseReady } from "@/server/db/verify-target";
import { publicAuthPayload } from "@/server/auth/public-response";
import { profileNameInput, profileSessionError } from "./profile";
import { securityDiagnostic } from "../security/diagnostics";
import { consumeAuthBudget } from "./rate-budget";
import { getPrisma } from "../db/client";

function errorResponse(status: number, code: string) {
  if (status === 401 || status === 403) securityDiagnostic("AUTH_DENIED");
  if (status === 429) securityDiagnostic("AUTH_RATE_LIMITED");
  if (code === "AUTH_SOURCE_UNAVAILABLE") securityDiagnostic("AUTH_SOURCE_UNAVAILABLE");
  return Response.json({ error: { code, message: status === 503 ? "Metro authentication is not available." : "Invalid authentication request." } }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  try {
    const environment = readServerEnvironment();
    if (!environment.enabled) return errorResponse(503, "AUTH_DISABLED");
    const path = new URL(request.url).pathname.slice("/api/auth".length);
    if (!(request.method === "GET" && path === "/get-session")
      && !(request.method === "POST" && ["/sign-up/email", "/sign-in/email", "/sign-out", "/send-verification-email", "/verify-email", "/update-user"].includes(path))) return errorResponse(404, "NOT_FOUND");
    let prepared = await prepareAuthRequest(request, environment);
    if (path === "/update-user") {
      const profile = profileNameInput(await prepared.clone().json());
      if (!profile) return errorResponse(400, "INVALID_PROFILE_NAME");
      const headers = new Headers(prepared.headers); headers.delete("content-length");
      prepared = new Request(prepared, { headers, body: JSON.stringify(profile) });
    }
    let verificationRequest: Request | undefined;
    if (path === "/verify-email") {
      const body: unknown = await prepared.clone().json();
      const token = body && typeof body === "object" ? (body as Record<string, unknown>).token : undefined;
      if (typeof token !== "string" || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
        || Object.keys(body as object).some(key => key !== "token")) return errorResponse(400, "INVALID_VERIFICATION_LINK");
      // Invoke Better Auth's official GET handler in memory. External requests
      // use POST so verification tokens never appear in request URL logs.
      const url = new URL("/api/auth/verify-email", environment.origin);
      url.searchParams.set("token", token);
      const headers = new Headers(prepared.headers);
      headers.delete("content-length");
      verificationRequest = new Request(url, { headers, signal: prepared.signal });
    }
    await assertWebsiteDatabaseReady(environment);
    await consumeAuthBudget(getPrisma(environment), prepared);
    if (path === "/update-user") {
      const session = await getAuth().api.getSession({ headers: prepared.headers, query: { disableCookieCache: true } });
      const failure = profileSessionError(session);
      if (failure) return errorResponse(failure === "UNAUTHENTICATED" ? 401 : 403, failure);
    }
    const handlers = toNextJsHandler(getAuth());
    const response = verificationRequest ? await handlers.GET(verificationRequest)
      : request.method === "POST" ? await handlers.POST(prepared) : await handlers.GET(prepared);
    const headers = new Headers(response.headers);
    if (response.status === 429) securityDiagnostic("AUTH_RATE_LIMITED");
    else if (response.status === 401 || response.status === 403) securityDiagnostic("AUTH_DENIED");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const body: unknown = await response.json();
    return new Response(JSON.stringify(publicAuthPayload(path, response.status, body)), { status: response.status, headers });
  } catch (error) {
    if (error instanceof AuthRequestError) return errorResponse(error.status, error.code);
    // Do not expose/log driver messages, passwords, tokens, or configuration.
    return errorResponse(503, "AUTH_UNAVAILABLE");
  }
}
