import { z } from "zod";
import { commerceRequest, commerceFailure, limitedBody } from "@/server/commerce/http";
import { getWebsiteRepositories } from "@/server/website";
import { FoundationError } from "@/server/owner/authorization";
import { revalidatePath } from "next/cache";
export async function POST(request: Request) {
  try {
    await commerceRequest(request);
    const data = z.strictObject({ id: z.uuid(), read: z.boolean() }).safeParse(JSON.parse((await limitedBody(request, 200)).toString()));
    if (!data.success) throw new FoundationError("INVALID_REQUEST");
    await (await getWebsiteRepositories()).readNotification(data.data.id, data.data.read);
    revalidatePath("/dashboard/notifications"); revalidatePath("/admin/notifications");
    return Response.json({ updated: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return commerceFailure(error); }
}
