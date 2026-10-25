"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { AccountMenu, type WorkspaceAccount } from "@/components/dashboard/account-menu";
import { dashboardNavigation } from "@/config/site";

export function DashboardShell({ children, account }: { children: React.ReactNode; account: WorkspaceAccount }) {
  const pathname = usePathname();
  const current = dashboardNavigation.find(item => item.href === pathname || item.href !== "/dashboard" && pathname.startsWith(item.href + "/"))?.label ?? "Workspace";
  return <div className="workspace-root">
    <a href="#main-content" className="skip-link">Skip to workspace</a>
    <aside className="workspace-sidebar" aria-label="Workspace sidebar">
      <BrandMark className="workspace-brand" />
      <div className="workspace-sidebar-heading"><span className="workspace-small-label">PERSONAL WORKSPACE</span><span className="workspace-sidebar-rule" /></div>
      <WorkspaceNavigation />
      <div className="workspace-sidebar-bottom"><p>Your digital essentials,<br />a little closer.</p><Link href="/">Back to Metro <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
    </aside>
    <div className="workspace-stage">
      <header className="workspace-topbar">
        <div className="workspace-mobile-brand"><BrandMark className="workspace-brand" /></div>
        <div className="workspace-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{current}</strong></div>
        <div className="workspace-header-actions"><Link href="/dashboard/notifications" className="workspace-notification-link" aria-label="Open notifications">Alerts</Link><ThemeToggle /><AccountMenu account={account} />
          <div className="workspace-mobile-menu"><Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open workspace navigation"><Menu size={20} aria-hidden="true" /></Button></SheetTrigger>
            <SheetContent className="workspace-drawer"><SheetTitle className="workspace-drawer-title">Your workspace</SheetTitle><SheetDescription className="workspace-drawer-description">Your services and account, together.</SheetDescription><WorkspaceNavigation mobile /></SheetContent>
          </Sheet></div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="workspace-content"><div className="workspace-page workspace-enter">{children}</div>
        <footer className="workspace-footer"><span>Metro · Your personal workspace</span><Link href="/services">Discover services <ArrowUpRight size={13} aria-hidden="true" /></Link></footer>
      </main>
    </div>
    <WorkspaceNavigation compact />
  </div>;
}
