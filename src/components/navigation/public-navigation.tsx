import { getWebsiteSession } from "@/server/auth/session";
import { getAccountDestination } from "@/server/auth/account-routing";
import { SplitDock } from "./split-dock";

export async function PublicNavigation() {
  const session = await getWebsiteSession();
  const dashboardHref = session ? await getAccountDestination(session) : null;
  return <SplitDock account={session ? { name: session.user.name, email: session.user.email } : undefined}
    dashboardHref={dashboardHref === "/admin" ? "/admin" : "/dashboard"} />;
}
