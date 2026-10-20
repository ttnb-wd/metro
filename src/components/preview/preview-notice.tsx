import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

export function PreviewNotice({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <aside aria-label="Preview information" className={cn("preview-notice", className)}><FlaskConical size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><div><strong className="font-medium">Service UI preview</strong><p>{children ?? "Your website account is real. Service management, ordering, and billing remain previews with no live subscriptions or VPN connection."}</p></div></aside>;
}
