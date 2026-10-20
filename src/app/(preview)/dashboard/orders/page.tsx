import { ShoppingBag } from "lucide-react";
import { DashboardHeading } from "@/components/dashboard/dashboard-heading";
import { EmptyState } from "@/components/preview/empty-state";

export default function OrdersPage() { return <><DashboardHeading title="Orders" description="A place to review your service purchases when ordering becomes available." /><EmptyState icon={ShoppingBag} title="Order history preview" description="No customer or order records are loaded here. Website ordering has not been enabled." href="/plans" action="View plan information" /></>; }
