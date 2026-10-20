import Link from "next/link";
import { ArrowUpRight, CircleUserRound, ShieldCheck, SlidersHorizontal, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ServiceCard({ detailed = false }: { detailed?: boolean }) {
  return <article className="service-card">
    <div className="service-copy">
      <div className="flex items-center justify-between gap-3"><span className="eyebrow text-muted-foreground">01 / OUR FIRST SERVICE</span><span className="service-tag">VPN</span></div>
      <div className="service-title"><span className="service-icon"><ShieldCheck size={25} strokeWidth={1.5} aria-hidden="true" /></span><h3>Secure Access</h3></div>
      <p className="service-description">A VPN service, with a dedicated place for your plan and setup. Your first digital essential on Metro.</p>
      {detailed && <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">Explore the service today. Account creation, purchases, and connection setup will become available in a later release.</p>}
      <Button variant="secondary" asChild className="mt-6"><Link href="/services/secure-access">Explore Secure Access <ArrowUpRight aria-hidden="true" /></Link></Button>
    </div>
    <div className="service-map" aria-label="Planned customer flow: your account, Secure Access, guided setup">
      <div className="map-caption"><span className="tiny-square" /> ONE CONNECTED EXPERIENCE</div>
      <div className="map-flow">
        <div className="map-node"><CircleUserRound size={19} aria-hidden="true" /><span>Your account</span></div>
        <div className="map-connector"><span /><ArrowRight size={12} aria-hidden="true" /></div>
        <div className="map-node map-node-featured"><ShieldCheck size={24} aria-hidden="true" /><span>Secure Access</span></div>
        <div className="map-connector"><span /><ArrowRight size={12} aria-hidden="true" /></div>
        <div className="map-node"><SlidersHorizontal size={19} aria-hidden="true" /><span>Guided setup</span></div>
      </div>
      <p className="map-note">A look at the experience we’re building.</p>
    </div>
  </article>;
}
