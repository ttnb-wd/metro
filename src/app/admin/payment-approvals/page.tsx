import { redirect } from "next/navigation";

// Keep existing reviewed payment management and OWNER authorization in one place.
export default function PaymentApprovalsPage() { redirect("/admin/payments"); }
