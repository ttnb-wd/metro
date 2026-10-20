"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, Settings, ArrowUpRight, LogOut } from "lucide-react";
import { accountInitials } from "@/features/workspace/identity";
import { submitAuth } from "@/features/auth/client";

export type WorkspaceAccount = { name: string; email: string };

export function AccountMenu({ account }: { account: WorkspaceAccount }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <DropdownMenu.Root onOpenChange={open => { if (!open) setError(null); }}>
    <DropdownMenu.Trigger className="workspace-account-trigger" aria-label="Open account menu">
      <span className="workspace-avatar" aria-hidden="true">{accountInitials(account.name)}</span>
      <span className="workspace-account-name">{account.name}</span><ChevronDown size={14} className="workspace-account-chevron" aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={10} collisionPadding={12} className="workspace-account-menu">
      <DropdownMenu.Label className="workspace-account-label"><span>YOUR ACCOUNT</span><strong>{account.name}</strong><p>{account.email}</p></DropdownMenu.Label>
      <DropdownMenu.Separator className="workspace-menu-separator" />
      <DropdownMenu.Item asChild><Link href="/dashboard/settings" className="workspace-menu-item"><Settings size={16} aria-hidden="true" />Account settings</Link></DropdownMenu.Item>
      <DropdownMenu.Item asChild><Link href="/" className="workspace-menu-item"><ArrowUpRight size={16} aria-hidden="true" />Back to Metro</Link></DropdownMenu.Item>
      <DropdownMenu.Separator className="workspace-menu-separator" />
      <DropdownMenu.Item disabled={pending} className="workspace-menu-item workspace-menu-logout" onSelect={async event => {
        event.preventDefault(); setPending(true); setError(null);
        const failure = await submitAuth("sign-out", {});
        if (failure) { setPending(false); setError(failure); return; }
        router.replace("/login"); router.refresh();
      }}><LogOut size={16} aria-hidden="true" />{pending ? "Signing out…" : "Log out"}</DropdownMenu.Item>
      {error && <p role="alert" className="workspace-menu-error">{error}</p>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
