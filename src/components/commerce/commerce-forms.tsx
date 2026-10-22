"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

async function send(url: string, body: object | FormData) {
  const response = await fetch(url, { method: "POST", headers: body instanceof FormData ? {} : { "Content-Type": "application/json" }, body: body instanceof FormData ? body : JSON.stringify(body), cache: "no-store" });
  let result;
  try { result = await response.json(); } catch { throw new Error("The service could not respond. Please retry."); }
  if (!response.ok) {
    if (body instanceof FormData && result.code === "INVALID_REQUEST") throw new Error("Upload a readable PNG or JPEG receipt up to 4 MB. Other file types and damaged images cannot be accepted.");
    throw new Error(typeof result.message === "string" ? result.message : "The request could not be completed. Please try again.");
  }
  return result;
}
export function EvidenceUpload({ orderId, resubmission = false }: { orderId: string; resubmission?: boolean }) {
  const key = useRef<string | null>(null), router = useRouter();
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  return <form className="commerce-form" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); key.current ??= crypto.randomUUID(); form.set("requestKey", key.current); setPending(true); setMessage(""); try { await send(`/api/orders/${orderId}/evidence`, form); key.current = null; setMessage("Proof received. Your payment is pending OWNER review; VPN access has not yet been activated."); router.refresh(); } catch (error) { setMessage((error as Error).message); } finally { setPending(false); } }}><label htmlFor="payment-proof">Payment proof · PNG or JPEG, up to 4 MB</label><input id="payment-proof" name="proof" type="file" accept="image/png,image/jpeg" required disabled={pending} onChange={() => { key.current = null; }} /><p>Upload a receipt showing the amount and transaction reference. Do not include passwords or wallet access codes.</p><Button disabled={pending}>{pending ? "Uploading securely…" : resubmission ? "Submit corrected proof" : "Submit payment proof"}</Button>{message && <p role="status">{message}</p>}</form>;
}
export function IssueForm({ serviceId }: { serviceId: string }) {
  const key = useRef<string | null>(null), router = useRouter();
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  return <form className="commerce-form" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); key.current ??= crypto.randomUUID(); setPending(true); try { await send("/api/commerce", { action: "issue", serviceId, description: form.get("description"), requestKey: key.current }); key.current = null; setMessage("Your issue was sent to Metro support."); router.refresh(); } catch (error) { setMessage((error as Error).message); } finally { setPending(false); } }}><label htmlFor={`issue-${serviceId}`}>VPN key not working?</label><textarea id={`issue-${serviceId}`} name="description" maxLength={1000} required placeholder="Describe the device, error and what you tried. Do not paste your VPN key." /><Button variant="secondary" disabled={pending}>{pending ? "Sending…" : "Report connection problem"}</Button>{message && <p role="status">{message}</p>}</form>;
}
export function RetryForm({ issueId, version, attempts }: { issueId: string; version: number; attempts: number }) {
  const router = useRouter(), key = useRef<string | null>(null);
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const tips = ["Remove the old server entry, import your current key again, then connect.", "Disconnect, close Outline, reopen it and reconnect using your current key.", "Try another Wi-Fi or mobile network, then reconnect."];
  if (attempts >= 3) return null;
  return <form className="commerce-form" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); key.current ??= crypto.randomUUID(); setPending(true); try { await send("/api/commerce", { action: "retry", issueId, version, expectedAttempt: attempts, result: form.get("result"), requestKey: key.current }); key.current = null; router.refresh(); } catch (error) { setMessage((error as Error).message); } finally { setPending(false); } }}><p>Support tested your key successfully. Attempt {attempts + 1} of 3: {tips[attempts]}</p><label>Connection result<select name="result"><option value="SUCCEEDED">It works now</option><option value="FAILED">Still not working</option></select></label><Button variant="secondary" disabled={pending}>Send retry result</Button>{message && <p role="alert">{message}</p>}</form>;
}
