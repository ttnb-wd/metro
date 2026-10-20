import { requireWebsiteSession } from "@/server/auth/session";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CreditCard } from "lucide-react";
import { PageIntro } from "@/components/marketing/page-intro";
import { PreviewNotice } from "@/components/preview/preview-notice";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Checkout preview" };
export default async function CheckoutPage() {
  await requireWebsiteSession("/checkout");
 return <div className="page-container content-page"><PageIntro eyebrow="CHECKOUT / PREVIEW" title="A clear next step."><p>This is a layout preview for a future checkout. No plan is selected and no payment can be made.</p></PageIntro><PreviewNotice>Your website account is signed in. Ordering and payments remain unavailable; this preview does not create a purchase.</PreviewNotice><div className="detail-grid"><section className="detail-panel"><CreditCard className="mb-5 text-accent" size={26} strokeWidth={1.5} aria-hidden="true" /><h2>Payment details</h2><p>Payment entry is unavailable. No card or personal information is collected here.</p><Button disabled className="mt-6">Payment unavailable</Button></section><section className="detail-panel"><span className="preview-badge">No order created</span><h2 className="mt-5">Order summary</h2><p>No service plan has been selected. Pricing, billing period, and totals will appear here once real plans and checkout are implemented.</p><Link href="/plans" className="text-link mt-5 gap-2 text-sm"><ArrowLeft size={15} aria-hidden="true" />Back to plan information</Link></section></div></div>; }
