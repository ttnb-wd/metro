import Link from "next/link";
import { ArrowUpRight, LayoutGrid, Compass } from "lucide-react";
import { DashboardHeading } from "@/components/dashboard/dashboard-heading";

export default function DashboardPage() {
  return <><DashboardHeading title="Your Metro, at a glance." description="A first look at the space planned for your services, orders, and account." /><div className="dashboard-cards"><article className="dashboard-card"><LayoutGrid size={23} strokeWidth={1.5} aria-hidden="true" /><h2>A home for your services.</h2><p>This area will show services associated with your account once authentication and service integration are available.</p><Link className="text-link" href="/dashboard/services">View services preview <ArrowUpRight size={14} aria-hidden="true" /></Link></article><article className="dashboard-card"><Compass size={23} strokeWidth={1.5} aria-hidden="true" /><h2>Start by exploring.</h2><p>Meet Secure Access, Metro’s first service. The public service pages explain what is planned.</p><Link className="text-link" href="/services/secure-access">Discover Secure Access <ArrowUpRight size={14} aria-hidden="true" /></Link></article></div></>;
}
