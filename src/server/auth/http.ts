import "server-only";
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { readServerEnvironment } from "@/server/env";
import { AuthRequestError, prepareAuthRequest } from "@/server/auth/request-policy";
import { assertWebsiteDatabaseReady } from "@/server/db/verify-target";
import { publicAuthPayload } from "@/server/auth/public-response";

function errorResponse(status: number, code: string) {
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
      && !(request.method === "POST" && ["/sign-up/email", "/sign-in/email", "/sign-out"].includes(path))) return errorResponse(404, "NOT_FOUND");
    const prepared = await prepareAuthRequest(request, environment);
    await assertWebsiteDatabaseReady(environment);
    const handlers = toNextJsHandler(getAuth());
    const response = request.method === "POST" ? await handlers.POST(prepared) : await handlers.GET(prepared);
    const headers = new Headers(response.headers);
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
