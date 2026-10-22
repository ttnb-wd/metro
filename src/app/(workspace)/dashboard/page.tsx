import { SupportUpdates } from "@/components/commerce/support-updates";
import { LiveRefresh } from "@/components/commerce/live-refresh";
import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { CustomerServices } from "@/components/commerce/service-list";
import { PublishedPricing } from "@/components/plans/published-pricing";
import { PageHeading } from "@/components/dashboard/workspace-components";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Page() {
  const { user } = await requireWebsiteSession("/dashboard");
  return <><PageHeading eyebrow="OVERVIEW" title={`Welcome, ${user.name}.`} description="Your Metro services and account, in one place." /><CustomerServices /><SupportUpdates /><PublishedPricing /><LiveRefresh /></>;
}
