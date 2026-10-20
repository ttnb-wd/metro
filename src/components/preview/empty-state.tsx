import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({ icon: Icon, title, description, href, action }: { icon: LucideIcon; title: string; description: string; href?: string; action?: string }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={27} strokeWidth={1.5} aria-hidden="true" /></span><h2>{title}</h2><p>{description}</p>{href && action && <Button variant="secondary" asChild><Link href={href}>{action}<ArrowUpRight aria-hidden="true" /></Link></Button>}</div>;
}
