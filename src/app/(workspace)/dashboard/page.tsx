import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { OverviewView } from "@/components/dashboard/workspace-views";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Page() {
  const { user } = await requireWebsiteSession("/dashboard");
  return <OverviewView name={user.name} />;
}
