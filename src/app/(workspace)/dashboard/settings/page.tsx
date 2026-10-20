import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { SettingsView } from "@/components/dashboard/workspace-views";

export const metadata: Metadata = { title: "Settings" };

export default async function Page() {
  const { user } = await requireWebsiteSession("/dashboard/settings");
  return <SettingsView account={{ name: user.name, email: user.email, createdAt: user.createdAt }} />;
}
