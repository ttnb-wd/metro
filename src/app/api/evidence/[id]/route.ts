import { getWebsiteRepositories } from "@/server/website";
import { evidenceStore } from "@/server/commerce/evidence-store";
import { commerceRequest, commerceFailure } from "@/server/commerce/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await commerceRequest(request, false);
    const row = await (await getWebsiteRepositories()).evidenceFile((await context.params).id);
    const bytes = await evidenceStore().get(row.storageRef, row.sha256);
    const disposition = new URL(request.url).searchParams.get("view") === "1" ? "inline" : "attachment";
    // Stream verified original bytes, including older proofs up to 5 MB, instead
    // of exceeding a serverless platform's buffered response-size ceiling.
    let offset = 0;
    const stream = new ReadableStream({ pull(controller) { if (offset >= bytes.length) { controller.close(); return; } const end = Math.min(offset + 65536, bytes.length); controller.enqueue(new Uint8Array(bytes.subarray(offset, end))); offset = end; } });
    return new Response(stream, { headers: { "Content-Type": "image/png", "Content-Disposition": `${disposition}; filename="metro-payment-${row.orderId}-${row.id}.png"`, "Content-Security-Policy": "default-src 'none'; sandbox", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return commerceFailure(error); }
}
