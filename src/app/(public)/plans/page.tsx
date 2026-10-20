import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PageIntro } from "@/components/marketing/page-intro";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Plans" };

export default function PlansPage() {
  return <div className="page-container content-page"><PageIntro eyebrow="PLANS, WITHOUT THE GUESSWORK" title="The details come first."><p>Secure Access plan information will appear here when it is ready. Prices, billing periods, and service limits have not been published on this website.</p></PageIntro><article className="plan-panel"><div><span className="preview-badge">Plan information pending</span><h2>Secure Access</h2><p>Metro’s first service is a VPN. There are no purchasable plans in this preview, and no payment will be collected.</p></div><Button variant="secondary" asChild><Link href="/services/secure-access">About the service <ArrowUpRight aria-hidden="true" /></Link></Button></article><div className="mt-7 flex flex-wrap items-center gap-x-6 text-sm"><Link className="text-link" href="/checkout">View checkout layout preview <ArrowUpRight className="ml-2 size-4" aria-hidden="true" /></Link><p className="text-xs text-muted-foreground">Preview only · No purchase available</p></div></div>;
}
