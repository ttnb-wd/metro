import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export const metadata: Metadata = { title: "Dashboard preview" };
export default function DashboardLayout({ children }: { children: React.ReactNode }) { return <DashboardShell>{children}</DashboardShell>; }
