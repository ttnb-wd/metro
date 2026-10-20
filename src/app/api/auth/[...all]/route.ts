import { handleAuthRequest } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
