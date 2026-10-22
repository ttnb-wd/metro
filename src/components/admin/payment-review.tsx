"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { rejectPayment, approvePayment } from "@/app/admin/actions";
import type { AdminActionState } from "@/features/pricing/action-state";
import { rejectionReasons } from "@/features/pricing/payment-review";

export function PaymentRejectionForm({ evidenceId, requestKey }: { evidenceId: string; requestKey: string }) {
  const [state, action, pending] = useActionState(rejectPayment, { status: "idle", message: "" } as AdminActionState);
  return <form action={action} className="admin-review-form"><input type="hidden" name="evidenceId" value={evidenceId} /><input type="hidden" name="requestKey" value={requestKey} /><label>Reason shown to the customer<select name="rejectionReason" required disabled={pending || state.status === "success"} defaultValue=""><option value="" disabled>Select a reason</option>{Object.entries(rejectionReasons).map(([code, description]) => <option value={code} key={code}>{description}</option>)}</select></label><label className="admin-checkbox"><input name="confirmed" type="checkbox" value="yes" required disabled={pending || state.status === "success"} />I have reviewed this submission and want to reject it.</label><p>This records a rejection and leaves the customer able to submit corrected proof.</p><Button size="sm" variant="secondary" disabled={pending || state.status === "success"}>{pending ? "Recording…" : "Reject evidence"}</Button>{state.message && <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}</form>;
}

export function PaymentApprovalForm({ evidenceId, requestKey, enabled }: { evidenceId: string; requestKey: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(approvePayment, { status: "idle", message: "" } as AdminActionState);
  return <form action={action} className="commerce-form"><input type="hidden" name="evidenceId" value={evidenceId} /><input type="hidden" name="requestKey" value={requestKey} /><div className="workspace-access-actions"><a className="text-link" href={`/api/evidence/${evidenceId}?view=1`} target="_blank" rel="noopener noreferrer">View proof securely ↗</a><a className="text-link" href={`/api/evidence/${evidenceId}`}>Download proof</a></div><label>Verified bank / wallet transaction reference<input name="transaction" minLength={4} maxLength={100} required disabled={!enabled || pending} autoComplete="off" /></label><label className="admin-checkbox"><input type="checkbox" name="confirmed" value="yes" required disabled={!enabled || pending} />I checked the actual receiving account, exact amount and reference. This payment is valid and has not been used for another order.</label><Button disabled={!enabled || pending || state.status === "success"}>{pending ? "Confirming…" : "Approve verified payment"}</Button>{!enabled && <p>Approval is disabled until the reviewed backend and fulfilment execution gate are active.</p>}{state.message && <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}</form>;
}
