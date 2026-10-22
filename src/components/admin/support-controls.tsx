"use client";
import { useActionState } from "react";
import { recordConnectionTest, requestKeyReplacement } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/features/pricing/action-state";
export function DiagnosisForm({ userId, issueId, version, requestKey }: { userId: string; issueId: string; version: number; requestKey: string }) {
  const [state, action, pending] = useActionState(recordConnectionTest, { status: "idle", message: "" } as AdminActionState);
  return <form action={action} className="commerce-form"><input type="hidden" name="userId" value={userId} /><input type="hidden" name="issueId" value={issueId} /><input type="hidden" name="version" value={version} /><input type="hidden" name="requestKey" value={requestKey} /><label>Manual Outline connection test<select name="result"><option value="SUCCEEDED">Connection succeeded</option><option value="FAILED">Connection failed</option></select></label><label className="admin-checkbox"><input type="checkbox" name="confirmed" value="yes" required />I personally tested this customer’s current native key in Outline.</label><Button disabled={pending || state.status === "success"}>Record test result</Button>{state.message && <p role="status">{state.message}</p>}</form>;
}
export function ReplacementForm({ userId, serviceId, issueId, expectedVersion, requestKey, enabled }: { userId: string; serviceId: string; issueId: string; expectedVersion: number; requestKey: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(requestKeyReplacement, { status: "idle", message: "" } as AdminActionState);
  return <form action={action} className="commerce-form">{Object.entries({ userId, serviceId, issueId, expectedVersion, requestKey }).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}<label className="admin-checkbox"><input type="checkbox" name="confirmed" value="yes" required disabled={!enabled} />Replace the failed key. Revoke the previous credential and preserve reconciled usage, remaining quota and exact expiry.</label><Button variant="secondary" disabled={!enabled || pending || state.status === "success"}>Request controlled replacement</Button>{!enabled && <p>The reviewed backend execution gate must be activated first.</p>}{state.message && <p role="status">{state.message}</p>}</form>;
}
