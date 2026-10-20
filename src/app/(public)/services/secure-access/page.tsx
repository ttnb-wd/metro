import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, UserRound, SlidersHorizontal, Layers3 } from "lucide-react";
import { PageIntro } from "@/components/marketing/page-intro";
import { Button } from "@/components/ui/button";
import { PreviewNotice } from "@/components/preview/preview-notice";

export const metadata: Metadata = { title: "Secure Access" };

export default function SecureAccessPage() {
  return <div className="page-container content-page"><PageIntro eyebrow="METRO / SECURE ACCESS" title="Your first digital essential."><p>Secure Access is Metro’s VPN service. This website introduces the service and previews a simpler place to manage your plan and setup.</p></PageIntro>
    <PreviewNotice>Website purchases, account access, and VPN setup are not enabled in this version. No live connection or provisioning is available here.</PreviewNotice>
    <div className="detail-grid"><section className="detail-panel"><span className="service-icon mb-5"><ShieldCheck aria-hidden="true" /></span><h2>Secure Access, through Metro.</h2><p>A dedicated service within a broader digital platform. Explore it here, then review the planned customer experience.</p><Button asChild className="mt-6"><Link href="/plans">View plan information <ArrowUpRight aria-hidden="true" /></Link></Button></section>
      <section className="detail-panel"><h2>The planned experience</h2><ul className="detail-list"><li><UserRound size={18} aria-hidden="true" /><span>Your own Metro account with email and password.</span></li><li><Layers3 size={18} aria-hidden="true" /><span>A dedicated place to review service and plan information.</span></li><li><SlidersHorizontal size={18} aria-hidden="true" /><span>A setup area for instructions after service activation.</span></li></ul><Button variant="secondary" asChild className="mt-6"><Link href="/setup">Explore setup preview <ArrowUpRight aria-hidden="true" /></Link></Button></section></div>
  </div>;
}
