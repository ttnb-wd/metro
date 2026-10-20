import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { ServicesView } from "@/components/dashboard/workspace-views";

export const metadata: Metadata = { title: "My services" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/services");
  return <ServicesView />;
}
