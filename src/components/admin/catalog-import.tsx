"use client";
import { useActionState } from "react";
import { importInitialCatalog } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/features/pricing/action-state";
export function CatalogImport({ requestKey, available }: { requestKey: string; available: boolean }) {
  const [state, action, pending] = useActionState(importInitialCatalog, { status: "idle", message: "" } as AdminActionState);
  return <section className="admin-panel"><h2>Initial package import</h2><p>Copy the current authoritative backend packages once. Website prices and discounts become independent after import. No seed prices are used.</p><form action={action}><input type="hidden" name="requestKey" value={requestKey} /><Button disabled={!available || pending || state.status === "success"}>{pending ? "Reading current catalog…" : "Import current backend packages"}</Button></form>{!available && <p>The authenticated backend catalog endpoint is not configured. Packages remain unpublished.</p>}{state.message && <p role="status">{state.message}</p>}</section>;
}
