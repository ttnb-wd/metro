import { LiveRefresh } from "@/components/commerce/live-refresh";
import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { CustomerServices } from "@/components/commerce/service-list";
import { PageHeading } from "@/components/dashboard/workspace-components";

export const metadata: Metadata = { title: "Secure Access" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/secure-access");
  return <><PageHeading eyebrow="SERVICE WORKSPACE" title="Secure Access" description="Your data allowance, expiry and private connection details." /><CustomerServices detailed /><LiveRefresh /></>;
}
