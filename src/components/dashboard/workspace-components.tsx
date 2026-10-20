import Link from "next/link";
import { ArrowUpRight, ArrowRight, Layers, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ServiceDefinition } from "@/config/services";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: ReactNode; description: string; action?: ReactNode }) {
  return <div className="workspace-page-heading"><div><p className="workspace-small-label">{eyebrow}</p><h1>{title}</h1><p className="workspace-description">{description}</p></div>{action && <div className="workspace-heading-action">{action}</div>}</div>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="workspace-section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function EmptyState({ title, description, href, action, compact = false }: { title: string; description: string; href?: string; action?: string; compact?: boolean }) {
  return <div className={`workspace-empty${compact ? " workspace-empty-compact" : ""}`}>
    <div className="workspace-empty-art" aria-hidden="true"><span /><span /><Layers size={25} strokeWidth={1.3} /></div>
    <h3>{title}</h3><p>{description}</p>
    {href && action && <Button asChild><Link href={href}>{action}<ArrowUpRight size={16} aria-hidden="true" /></Link></Button>}
  </div>;
}

export function QuickActionCard({ title, description, href, label }: { title: string; description: string; href: string; label: string }) {
  return <Link href={href} className="workspace-quick-action"><span className="workspace-small-label">{label}</span><div><h3>{title}</h3><ArrowUpRight size={20} strokeWidth={1.5} aria-hidden="true" /></div><p>{description}</p></Link>;
}

export function ServiceOverviewCard({ service }: { service: ServiceDefinition }) {
  const Icon = service.category === "VPN" ? Shield : Layers;
  return <article className="workspace-service-card"><div className="workspace-service-heading"><div className="workspace-service-symbol" aria-hidden="true"><Icon size={22} strokeWidth={1.5} /></div><span className="workspace-status">Available to explore</span></div>
    <div><p className="workspace-small-label">{service.category}</p><h3>{service.name}</h3><p>{service.description}</p></div>
    <Link href={service.href} className="workspace-inline-link">Discover {service.name}<ArrowRight size={16} aria-hidden="true" /></Link>
  </article>;
}

export function WorkspaceNote({ children }: { children: ReactNode }) {
  return <p className="workspace-note"><span aria-hidden="true" />{children}</p>;
}
