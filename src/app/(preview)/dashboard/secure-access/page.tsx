import { ShieldCheck } from "lucide-react";
import { DashboardHeading } from "@/components/dashboard/dashboard-heading";
import { EmptyState } from "@/components/preview/empty-state";

export default function AccessPreviewPage() { return <><DashboardHeading title="Secure Access" description="A dedicated space for your future VPN service details and setup." /><EmptyState icon={ShieldCheck} title="Service management preview" description="No plan, access key, connection status, or VPN server is connected. This screen does not activate or manage a service." href="/setup" action="View setup preview" /></>; }
