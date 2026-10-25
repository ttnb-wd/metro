import Link from "next/link";
import { ArrowUpRight, CircleUserRound, ShieldCheck, SlidersHorizontal, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { secureAccess, type ServiceDefinition } from "@/config/services";

export function ServiceCard({ detailed = false, service = secureAccess, headingLevel = 3 }: { detailed?: boolean; service?: ServiceDefinition; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <article className="service-card">
    <div className="service-copy">
      <div className="flex items-center justify-between gap-3"><span className="eyebrow text-muted-foreground">CURRENT SERVICE</span><span className="service-tag">{service.category}</span></div>
      <div className="service-title"><span className="service-icon"><ShieldCheck size={25} strokeWidth={1.5} aria-hidden="true" /></span><Heading>{service.name}</Heading></div>
      <p className="service-description">{service.description}</p>
      {detailed && <p className="catalog-service-note">Available through Outline Client for desktop and mobile. Choose a plan online and activate after payment review.</p>}
      <div className="service-actions"><Button variant="secondary" asChild><Link href={service.href}>Service details <ArrowUpRight aria-hidden="true" /></Link></Button><Link href={service.plansHref} className="text-link gap-2 text-xs">View plans <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
    </div>
    <div className="service-map" aria-label="Planned customer flow: your account, Secure Access, guided setup">
      <div className="map-caption"><span className="tiny-square" /> ONE CONNECTED EXPERIENCE</div>
      <div className="map-flow">
        <div className="map-node"><CircleUserRound size={19} aria-hidden="true" /><span>Your account</span></div>
        <div className="map-connector"><span /><ArrowRight size={12} aria-hidden="true" /></div>
        <div className="map-node map-node-featured"><ShieldCheck size={24} aria-hidden="true" /><span>{service.name}</span></div>
        <div className="map-connector"><span /><ArrowRight size={12} aria-hidden="true" /></div>
        <div className="map-node"><SlidersHorizontal size={19} aria-hidden="true" /><span>Guided setup</span></div>
      </div>
      <p className="map-note">From your own account to a private connection.</p>
    </div>
  </article>;
}
