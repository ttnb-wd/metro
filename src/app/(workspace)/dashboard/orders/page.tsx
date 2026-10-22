import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { CustomerOrders } from "@/components/commerce/order-list";
import { PageHeading } from "@/components/dashboard/workspace-components";

export const metadata: Metadata = { title: "Orders" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/orders");
  return <><PageHeading eyebrow="YOUR PURCHASES" title="Orders" description="Payment review and VPN fulfilment, tracked separately." /><CustomerOrders /></>;
}
