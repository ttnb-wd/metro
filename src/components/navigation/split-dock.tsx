"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { ArrowUpRight, Menu } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { publicNavigation } from "@/config/site";
import { cn } from "@/lib/utils";

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

const getScrolledSnapshot = () => window.scrollY > 12;
const getServerScrolledSnapshot = () => false;

export function SplitDock() {
  const pathname = usePathname();
  const scrolled = useSyncExternalStore(subscribeToScroll, getScrolledSnapshot, getServerScrolledSnapshot);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return <header className="site-header" data-scrolled={scrolled}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <nav aria-label="Main navigation" className="split-dock">
      <div className="dock-capsule brand-capsule"><BrandMark /></div>
      <div className="dock-capsule center-capsule hidden md:flex">
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={cn("dock-link", pathname === "/" && "is-active")}>Home</Link>
        {publicNavigation.map(item => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} className={cn("dock-link", isActive(item.href) && "is-active")}>{item.label}</Link>)}
      </div>
      <div className="dock-capsule action-capsule">
        <ThemeToggle />
        <Button variant="ghost" size="sm" asChild className="hidden min-[390px]:inline-flex"><Link href="/login" aria-current={pathname === "/login" ? "page" : undefined}>Log in</Link></Button>
        <Button size="sm" asChild className="hidden md:inline-flex"><Link href="/register" aria-current={pathname === "/register" ? "page" : undefined}>Get started <ArrowUpRight aria-hidden="true" /></Link></Button>
        <Sheet>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu"><Menu aria-hidden="true" /></Button></SheetTrigger>
          <SheetContent>
            <SheetTitle className="mt-2 font-display text-xl font-semibold">Explore Metro</SheetTitle>
            <SheetDescription className="mt-2 text-sm text-muted-foreground">Your digital services, connected.</SheetDescription>
            <div className="mt-8 flex flex-col gap-2">
              {[{ href: "/", label: "Home" }, ...publicNavigation, { href: "/login", label: "Log in" }, { href: "/register", label: "Create account" }].map(item => <SheetClose asChild key={item.href}><Link href={item.href} aria-current={(item.href === "/" ? pathname === "/" : isActive(item.href)) ? "page" : undefined} className="flex min-h-12 items-center justify-between rounded-xl px-4 text-sm hover:bg-secondary aria-[current=page]:bg-secondary aria-[current=page]:text-accent">{item.label}<ArrowUpRight size={16} aria-hidden="true" /></Link></SheetClose>)}
            </div>
            <p className="mt-auto pt-8 text-xs leading-6 text-muted-foreground">Account and checkout screens are previews in this version.</p>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  </header>;
}
