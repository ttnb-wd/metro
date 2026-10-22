import { LiveRefresh } from "@/components/commerce/live-refresh";
import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { CustomerServices } from "@/components/commerce/service-list";
import { PublishedPricing } from "@/components/plans/published-pricing";
import { PageHeading } from "@/components/dashboard/workspace-components";

export const metadata: Metadata = { title: "My services" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/services");
  return <><PageHeading eyebrow="YOUR COLLECTION" title="My services" description="Your purchased services and current package availability." /><CustomerServices /><LiveRefresh /><PublishedPricing /></>;
}
