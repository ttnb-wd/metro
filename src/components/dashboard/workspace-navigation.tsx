"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, PanelsTopLeft, Shield, ShoppingBag, CreditCard, Settings, Bell } from "lucide-react";
import { dashboardNavigation } from "@/config/site";
import { SheetClose } from "@/components/ui/sheet";

const icons = { overview: PanelsTopLeft, services: LayoutGrid, access: Shield, orders: ShoppingBag, billing: CreditCard, settings: Settings, notifications: Bell };

export function WorkspaceNavigation({ mobile = false, compact = false }: { mobile?: boolean; compact?: boolean }) {
  const pathname = usePathname();
  const entries = compact ? dashboardNavigation.filter(item => ["overview", "services", "orders", "settings"].includes(item.icon)) : dashboardNavigation;
  return <nav aria-label={compact ? "Quick workspace navigation" : "Workspace navigation"} className={compact ? "workspace-bottom-nav" : "workspace-nav"}>
    {entries.map(item => {
      const Icon = icons[item.icon];
      const current = pathname === item.href ? "page" : item.href !== "/dashboard" && pathname.startsWith(item.href + "/") ? "location" : compact && item.icon === "services" && pathname === "/dashboard/secure-access" ? "location" : undefined;
      const link = <Link href={item.href} aria-current={current}>
        <Icon size={18} strokeWidth={1.6} aria-hidden="true" /><span>{compact && item.icon === "services" ? "Services" : item.label}</span>
        {!compact && current && <span className="workspace-nav-marker" aria-hidden="true" />}
      </Link>;
      return mobile && !compact ? <SheetClose asChild key={item.href}>{link}</SheetClose> : <div key={item.href}>{link}</div>;
    })}
  </nav>;
}
