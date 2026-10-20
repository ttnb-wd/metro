"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelsTopLeft, LayoutGrid, ShieldCheck, ShoppingBag, CreditCard, Settings, PanelLeft, ArrowUpRight } from "lucide-react";
import { dashboardNavigation } from "@/config/site";
import { PreviewNotice } from "@/components/preview/preview-notice";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const icons = { overview: PanelsTopLeft, services: LayoutGrid, access: ShieldCheck, orders: ShoppingBag, billing: CreditCard, settings: Settings };

function DashboardNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return <nav className="dashboard-nav" aria-label="Dashboard navigation">{dashboardNavigation.map(item => {
    const Icon = icons[item.icon];
    const link = <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined}><Icon size={17} strokeWidth={1.5} aria-hidden="true" />{item.label}</Link>;
    return mobile ? <SheetClose key={item.href} asChild>{link}</SheetClose> : <div key={item.href}>{link}</div>;
  })}</nav>;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return <div className="dashboard-wrap page-container"><aside className="dashboard-sidebar"><p className="eyebrow">YOUR WORKSPACE / PREVIEW</p><DashboardNav /><p className="mt-8 px-3 text-xs leading-6 text-muted-foreground">A preview of your future Metro account. No one is signed in.</p><Link href="/services" className="text-link mt-4 gap-2 px-3 text-xs">Explore services <ArrowUpRight size={13} aria-hidden="true" /></Link></aside>
    <div className="dashboard-main"><div className="mobile-dashboard-menu"><Sheet><SheetTrigger asChild><Button variant="secondary"><PanelLeft aria-hidden="true" />Dashboard menu</Button></SheetTrigger><SheetContent><SheetTitle className="mt-2 font-display text-xl font-medium">Dashboard preview</SheetTitle><SheetDescription className="mb-7 mt-2 text-xs leading-6 text-muted-foreground">Public design preview. No account is signed in.</SheetDescription><DashboardNav mobile /></SheetContent></Sheet></div>
      <PreviewNotice />{children}
    </div></div>;
}
