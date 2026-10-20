import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return <Link href="/" aria-label="Metro home" className={cn("inline-flex min-h-11 items-center gap-2.5 rounded-xl font-display text-xl font-semibold tracking-[-0.06em]", className)}>
    <Image src="/brand/metro-logo.png" alt="" width={34} height={34} className="rounded-[10px]" priority />
    <span>metro<span className="text-accent">.</span></span>
  </Link>;
}
