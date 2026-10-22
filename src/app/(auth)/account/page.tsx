import { redirect } from "next/navigation";
import { requireWebsiteSession } from "@/server/auth/session";
import { getAccountDestination } from "@/server/auth/account-routing";
import { safeReturnPath } from "@/features/auth/redirects";

export default async function AccountEntry({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const requested = safeReturnPath((await searchParams).next);
  const session = await requireWebsiteSession(requested);
  redirect(await getAccountDestination(session, requested));
}
