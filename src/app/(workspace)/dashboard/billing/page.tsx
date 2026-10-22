import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { CustomerOrders } from "@/components/commerce/order-list";
import { PageHeading } from "@/components/dashboard/workspace-components";

export const metadata: Metadata = { title: "Billing" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/billing");
  return <><PageHeading eyebrow="ACCOUNT / BILLING" title="Billing" description="Your actual payment records and submitted evidence." /><CustomerOrders billing /></>;
}
