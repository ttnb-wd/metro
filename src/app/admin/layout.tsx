import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { adminPage, getAdminRepository } from "@/server/admin";
import "./admin.css";
import "@/styles/receipts.css";

export const metadata: Metadata = { title: "Metro administration", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await adminPage(async () => (await getAdminRepository()).identity());
  return <AdminShell account={{ name: account.name, email: account.email }}>{children}</AdminShell>;
}
