"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, Settings, ArrowUpRight, LogOut } from "lucide-react";
import { accountInitials } from "@/features/workspace/identity";
import { submitAuth } from "@/features/auth/client";
import styles from "./account-menu.module.css";

export type WorkspaceAccount = { name: string; email: string };

export function AccountMenu({ account, settingsHref = "/dashboard/settings", dashboardHref, compact = false }: { account: WorkspaceAccount; settingsHref?: "/dashboard/settings" | "/admin/settings"; dashboardHref?: "/dashboard" | "/admin"; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <DropdownMenu.Root onOpenChange={open => { if (!open) setError(null); }}>
    <DropdownMenu.Trigger type="button" className={`${styles.trigger}${compact ? ` ${styles.compact}` : ""}`} aria-label="Open account menu">
      <span className={styles.avatar} aria-hidden="true">{accountInitials(account.name)}</span>
      <span className={styles.name}>{account.name}</span><ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="end" side="bottom" sideOffset={10} collisionPadding={12} avoidCollisions className={styles.content} aria-busy={pending}>
      <DropdownMenu.Label className={styles.label}><span>YOUR ACCOUNT</span><strong>{account.name}</strong><p>{account.email}</p></DropdownMenu.Label>
      <DropdownMenu.Separator className={styles.separator} />
      {dashboardHref && <DropdownMenu.Item asChild><Link href={dashboardHref} className={styles.item}><ArrowUpRight size={16} aria-hidden="true" />Dashboard</Link></DropdownMenu.Item>}
      <DropdownMenu.Item asChild><Link href={settingsHref} className={styles.item}><Settings size={16} aria-hidden="true" />Account settings</Link></DropdownMenu.Item>
      <DropdownMenu.Item asChild><Link href="/" className={styles.item}><ArrowUpRight size={16} aria-hidden="true" />Back to Metro</Link></DropdownMenu.Item>
      <DropdownMenu.Separator className={styles.separator} />
      <DropdownMenu.Item disabled={pending} className={`${styles.item} ${styles.logout}`} onSelect={async event => {
        event.preventDefault(); if (pending) return; setPending(true); setError(null);
        const failure = await submitAuth("sign-out", {});
        if (failure) { setPending(false); setError(failure); return; }
        router.replace("/login"); router.refresh();
      }}><LogOut size={16} aria-hidden="true" />{pending ? "Signing out…" : "Log out"}</DropdownMenu.Item>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
