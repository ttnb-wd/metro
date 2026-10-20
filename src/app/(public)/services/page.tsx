import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Layers3 } from "lucide-react";
import { PageIntro } from "@/components/marketing/page-intro";
import { ServiceCard } from "@/components/marketing/service-card";
import { services } from "@/config/services";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  const availableServices = services.filter(service => service.availability === "available");
  return <div className="page-container content-page public-refinement">
    <PageIntro eyebrow="THE METRO COLLECTION" title="One place. Your essentials."><p>Discover Metro’s digital services, starting with Secure Access VPN. Explore what it provides, compare durations, and see how setup will work.</p></PageIntro>
    <section aria-labelledby="catalog-title"><div className="catalog-heading"><h2 id="catalog-title">Available services</h2><span>{availableServices.length} service</span></div><div className="service-catalog">{availableServices.map(service => <ServiceCard key={service.id} service={service} detailed />)}</div></section>
    <aside className="catalog-outlook"><Layers3 size={22} strokeWidth={1.5} aria-hidden="true" /><div><h2>Starting focused. Room to grow.</h2><p>Secure Access is Metro’s only current service. Future digital services will join this collection when they’re ready.</p></div><Link href="/plans" className="text-link gap-2 text-sm">Explore the plan prototype <ArrowUpRight size={15} aria-hidden="true" /></Link></aside>
  </div>;
}
