import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { OrdersView } from "@/components/dashboard/workspace-views";

export const metadata: Metadata = { title: "Orders" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/orders");
  return <OrdersView />;
}
