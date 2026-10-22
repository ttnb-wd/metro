import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";

export function Footer() {
  return <footer className="site-footer page-container">
    <div className="flex flex-col justify-between gap-8 sm:flex-row">
      <div><BrandMark /><p className="mt-3 text-sm text-muted-foreground">Your digital essentials. One place.</p></div>
      <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Link className="footer-link" href="/services">Services</Link><Link className="footer-link" href="/plans">Plans</Link><Link className="footer-link" href="/login">Log in</Link>
        <Link className="footer-link" href="/dashboard">My account <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </nav>
    </div>
    <div className="footer-bottom"><span>© {new Date().getFullYear()} Metro</span><span>Digital services, connected.</span></div>
  </footer>;
}
