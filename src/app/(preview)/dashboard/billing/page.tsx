import { CreditCard } from "lucide-react";
import { DashboardHeading } from "@/components/dashboard/dashboard-heading";
import { EmptyState } from "@/components/preview/empty-state";

export default function BillingPage() { return <><DashboardHeading title="Billing" description="The planned location for payment history and billing information." /><EmptyState icon={CreditCard} title="Billing is not connected." description="No payment method, invoice, balance, or subscription data is available. This preview does not collect payments." href="/checkout" action="View checkout preview" /></>; }
