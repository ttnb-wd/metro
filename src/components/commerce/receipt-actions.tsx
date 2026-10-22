"use client";
import { Button } from "@/components/ui/button";
export function ReceiptActions({ orderId }: { orderId: string }) {
  return <div className="workspace-access-actions receipt-actions"><Button type="button" onClick={() => window.print()}>Print / save PDF</Button><Button variant="secondary" asChild><a href={`/api/orders/${orderId}/receipt?download=1`}>Download receipt (.html)</a></Button></div>;
}
