import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

export function PreviewNotice({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <aside aria-label="Preview information" className={cn("preview-notice", className)}><FlaskConical size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><div><strong className="font-medium">UI preview only</strong><p>{children ?? "This page is publicly accessible for design review. No account, customer data, or live service is connected."}</p></div></aside>;
}
