import Link from "next/link";
import { ArrowRight, ArrowUpRight, Layers3, LayoutGrid, UserRound, Compass, MoveUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceCard } from "@/components/marketing/service-card";
import { Reveal } from "@/components/marketing/reveal";

const steps = [
  { number: "01", title: "Find your essential.", description: "Explore the service, understand what it offers, and find what fits your needs.", icon: Compass },
  { number: "02", title: "Make it yours.", description: "The planned account flow brings your services into one independent Metro account.", icon: UserRound },
  { number: "03", title: "Get set up.", description: "A dedicated setup area will help you take the next step after choosing a service.", icon: MoveUpRight },
];

export default function Home() {
  return <>
    <section className="hero page-container" aria-labelledby="hero-heading">
      <div className="hero-wash" aria-hidden="true" />
      <Reveal className="hero-content">
        <p className="eyebrow hero-eyebrow"><span className="eyebrow-line" />YOUR DIGITAL SERVICES, CONNECTED</p>
        <h1 id="hero-heading">Your digital essentials.<br /><span>One place.</span></h1>
        <p className="hero-description">Digital services, brought together by Metro. Start with <strong>Secure Access VPN</strong> and explore a plan that fits your needs.</p>
        <div className="hero-actions"><Button size="lg" asChild><Link href="/services/secure-access">Explore Secure Access <ArrowUpRight aria-hidden="true" /></Link></Button><Button size="lg" variant="secondary" asChild><Link href="/plans">Estimate your plan <ArrowRight aria-hidden="true" /></Link></Button></div>
        <p className="hero-footnote">Our first service is here to explore. Website purchases are coming later.</p>
      </Reveal>
    </section>
    <section className="service-section page-container" aria-labelledby="available-heading">
      <div className="section-caption"><h2 id="available-heading">Available service</h2><span className="caption-aside">THE METRO COLLECTION / 01</span></div>
      <ServiceCard />
    </section>
    <section className="how-section page-container" aria-labelledby="how-heading">
      <div className="section-heading"><p className="eyebrow">A SIMPLE WAY FORWARD</p><h2 id="how-heading">From discovery<br />to your everyday.</h2><p>The experience we’re building keeps the journey clear, at every step.</p></div>
      <div className="steps-grid">{steps.map(({ number, title, description, icon: Icon }) => <article key={number} className="step"><div className="step-top"><span>{number}</span><Icon size={21} strokeWidth={1.5} aria-hidden="true" /></div><h3>{title}</h3><p>{description}</p></article>)}</div>
    </section>
    <section className="benefits-section page-container" aria-labelledby="benefits-heading">
      <div className="section-heading"><p className="eyebrow">INTENTIONALLY CONNECTED</p><h2 id="benefits-heading">Less to navigate.<br />More in one place.</h2></div>
      <div className="benefits-grid">
        <article><LayoutGrid size={23} strokeWidth={1.5} aria-hidden="true" /><h3>A clear starting point.</h3><p>Explore what Metro offers with service details in plain language.</p></article>
        <article><UserRound size={23} strokeWidth={1.5} aria-hidden="true" /><h3>An account of your own.</h3><p>Designed around an independent email and password login.</p></article>
        <article><Layers3 size={23} strokeWidth={1.5} aria-hidden="true" /><h3>Room for what’s next.</h3><p>Secure Access comes first. Additional digital services can follow.</p></article>
      </div>
    </section>
    <section className="final-cta page-container" aria-labelledby="cta-heading"><div><p className="eyebrow">START WITH THE ESSENTIALS</p><h2 id="cta-heading">A little more connected.</h2><p>Get to know Secure Access, Metro’s first service.</p></div><Button size="lg" asChild><Link href="/services/secure-access">Discover Secure Access <ArrowUpRight aria-hidden="true" /></Link></Button></section>
  </>;
}
