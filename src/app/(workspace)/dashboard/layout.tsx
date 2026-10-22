import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getWebsiteSession } from "@/server/auth/session";
import { getAccountDestination } from "@/server/auth/account-routing";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Dashboard" };
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getWebsiteSession();
  // Each page redirects with its exact return path when no session exists.
  if (!session) return children;
  if (await getAccountDestination(session) === "/admin") redirect("/admin");
  const { user } = session;
  return <DashboardShell account={{ name: user.name, email: user.email }}>{children}</DashboardShell>;
}
