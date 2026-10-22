"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { AccountMenu, type WorkspaceAccount } from "@/components/dashboard/account-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { adminHref, adminSections } from "@/config/admin";

function AdminNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return <nav aria-label="Administration" className="admin-navigation">{["WORKSPACE", "COMMERCE", "OPERATIONS", "ACCOUNT"].map(group => <div key={group} className="admin-nav-group"><p>{group}</p>{adminSections.filter(section => section.group === group).map(section => {
    const href = adminHref(section.slug); const active = pathname === href || section.slug === "customers" && pathname.startsWith("/admin/customers/");
    const link = <Link href={href} aria-current={active ? "page" : undefined}><span>{section.label}</span><span className="admin-nav-indicator" aria-hidden="true" /></Link>;
    return mobile ? <SheetClose asChild key={href}>{link}</SheetClose> : <div key={href}>{link}</div>;
  })}</div>)}</nav>;
}

export function AdminShell({ account, children }: { account: WorkspaceAccount; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = adminSections.find(section => adminHref(section.slug) === pathname)?.label ?? "Customer details";
  return <div className="admin-root">
    <a href="#admin-content" className="skip-link">Skip to administration</a>
    <aside className="admin-sidebar"><BrandMark /><span className="admin-owner-label">OWNER CONSOLE</span><AdminNavigation /><Link href="/" className="admin-customer-link">View public website <ArrowUpRight size={14} aria-hidden="true" /></Link></aside>
    <div className="admin-stage"><header className="admin-topbar"><div className="admin-mobile-trigger"><Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open administration navigation"><Menu size={21} aria-hidden="true" /></Button></SheetTrigger><SheetContent className="admin-drawer"><SheetTitle>Metro administration</SheetTitle><SheetDescription>Website management for the verified OWNER.</SheetDescription><AdminNavigation mobile /></SheetContent></Sheet></div><div className="admin-breadcrumb"><span>Metro</span><span aria-hidden="true">/</span><strong>{current}</strong></div><div className="admin-topbar-actions"><ThemeToggle /><AccountMenu account={account} settingsHref="/admin/settings" /></div></header>
      <main id="admin-content" className="admin-content" tabIndex={-1}>{children}</main>
      <footer className="admin-footer"><span>Metro · Website administration</span><Link href="/">View public website <ArrowUpRight size={13} aria-hidden="true" /></Link></footer>
    </div>
  </div>;
}
