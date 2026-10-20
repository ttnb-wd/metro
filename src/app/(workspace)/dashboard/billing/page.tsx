import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { BillingView } from "@/components/dashboard/workspace-views";

export const metadata: Metadata = { title: "Billing" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/billing");
  return <BillingView />;
}
