import { LayoutGrid } from "lucide-react";
import { DashboardHeading } from "@/components/dashboard/dashboard-heading";
import { EmptyState } from "@/components/preview/empty-state";

export default function MyServicesPage() { return <><DashboardHeading title="My services" description="The planned home for services linked to your Metro account." /><EmptyState icon={LayoutGrid} title="Your services will belong here." description="No account or service data is connected to this preview. Explore the public service collection to learn more." href="/services" action="Explore services" /></>; }
