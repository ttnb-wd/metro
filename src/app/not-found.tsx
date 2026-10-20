import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/brand-mark";

export default function NotFound() { return <main id="main-content" className="page-container flex min-h-dvh flex-col items-center justify-center gap-7 text-center"><BrandMark /><p className="eyebrow text-muted-foreground">404 / PAGE NOT FOUND</p><h1 className="font-display text-4xl tracking-tight">Let’s get you back.</h1><p className="text-sm text-muted-foreground">This page isn’t part of Metro.</p><Button asChild><Link href="/">Return home</Link></Button></main>; }
