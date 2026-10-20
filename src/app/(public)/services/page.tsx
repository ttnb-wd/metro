import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/page-intro";
import { ServiceCard } from "@/components/marketing/service-card";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return <div className="page-container content-page"><PageIntro eyebrow="THE METRO COLLECTION" title="Start with an essential."><p>One place to discover your digital services. Meet Secure Access, our first service. More can follow as Metro grows.</p></PageIntro><ServiceCard detailed /><p className="mt-6 text-xs leading-6 text-muted-foreground">Secure Access is the only service currently presented on Metro. Purchases are not yet enabled on this website.</p></div>;
}
