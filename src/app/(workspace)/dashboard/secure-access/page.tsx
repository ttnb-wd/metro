import type { Metadata } from "next";
import { requireWebsiteSession } from "@/server/auth/session";
import { SecureAccessView } from "@/components/dashboard/workspace-views";

export const metadata: Metadata = { title: "Secure Access" };

export default async function Page() {
  await requireWebsiteSession("/dashboard/secure-access");
  return <SecureAccessView />;
}
