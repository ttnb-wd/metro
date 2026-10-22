"use client";
import { useActionState } from "react";
import { retryFulfilment } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/features/pricing/action-state";
export function FulfilmentRetry({ operationId, userId, version, requestKey, enabled }: { operationId: string; userId: string; version: number; requestKey: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(retryFulfilment, { status: "idle", message: "" } as AdminActionState);
  return <form action={action} className="commerce-form">{Object.entries({ operationId, userId, version, requestKey }).map(([key, value]) => <input type="hidden" name={key} value={value} key={key} />)}<label className="admin-checkbox"><input type="checkbox" name="confirmed" value="yes" required disabled={!enabled} />I reviewed the failure and backend readiness. Retry this same operation using its existing idempotency identity.</label><Button disabled={!enabled || pending || state.status === "success"}>Retry fulfilment</Button>{state.message && <p role="status">{state.message}</p>}</form>;
}
