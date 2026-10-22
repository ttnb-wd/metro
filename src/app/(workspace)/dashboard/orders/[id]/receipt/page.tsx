import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWebsiteSession } from "@/server/auth/session";
import { getWebsiteRepositories } from "@/server/website";
import { FoundationError } from "@/server/owner/authorization";
import { orderNumber, receiptBody, receiptStyles } from "@/features/pricing/receipt";
import { ReceiptActions } from "@/components/commerce/receipt-actions";
import { PageHeading } from "@/components/dashboard/workspace-components";
import "@/styles/receipts.css";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireWebsiteSession(`/dashboard/orders/${id}/receipt`);
  const receipt = await (await getWebsiteRepositories()).orderReceipt(id).catch(error => {
    if (error instanceof FoundationError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return <><PageHeading eyebrow="METRO RECEIPT" title="Your order receipt" description={orderNumber(id)} /><ReceiptActions orderId={id} /><style>{receiptStyles}</style><div className="receipt-document" dangerouslySetInnerHTML={{ __html: receiptBody(receipt) }} /><Link className="text-link receipt-actions" href={`/dashboard/orders/${id}`}>Back to order →</Link></>;
}
