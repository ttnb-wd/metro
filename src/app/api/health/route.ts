export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Liveness only; never represents payment, VPN or provider eligibility checks.
export function GET() {
  return Response.json({ status: "ok", component: "metro-web" }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
