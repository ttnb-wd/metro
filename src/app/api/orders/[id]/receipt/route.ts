import { getWebsiteRepositories } from "@/server/website";
import { commerceRequest, commerceFailure } from "@/server/commerce/http";
import { receiptDocument } from "@/features/pricing/receipt";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await commerceRequest(request, false);
    const receipt = await (await getWebsiteRepositories()).orderReceipt((await context.params).id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(receiptDocument(receipt), { headers: {
      "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="metro-receipt-${receipt.id}.html"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox allow-modals",
    } });
  } catch (error) { return commerceFailure(error); }
}
