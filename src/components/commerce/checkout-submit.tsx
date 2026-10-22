"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PAYMENT_PROOF_BYTES } from "@/features/commerce/evidence-policy";
import { Button } from "@/components/ui/button";

export function CheckoutSubmit({ orderId }: { orderId: string }) {
  const router = useRouter(), requestKey = useRef<string | null>(null), active = useRef(false), previewRef = useRef(""), inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "checking" | "success">("idle");
  const [progress, setProgress] = useState(0), [error, setError] = useState("");
  const pending = phase !== "idle";
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  function clearSelection(message = "", clearInput = true) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ""; requestKey.current = null;
    if (clearInput && inputRef.current) inputRef.current.value = "";
    setPreview(""); setFile(null); setError(message); setProgress(0);
  }
  return <section className="checkout-proof-panel checkout-card" aria-labelledby="proof-heading"><h2 id="proof-heading">Payment screenshot</h2><p className="checkout-help">After paying, upload a clear receipt showing the amount and transaction reference.</p>
    <form className="checkout-proof-form" aria-busy={pending} onSubmit={event => {
      event.preventDefault(); if (active.current) return;
      if (!file) { setError("Choose your payment screenshot before submitting."); return; }
      active.current = true; setError(""); setProgress(0); setPhase("uploading"); requestKey.current ??= crypto.randomUUID();
      const form = new FormData(); form.set("proof", file); form.set("orderId", orderId); form.set("requestKey", requestKey.current);
      const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/checkout/submit"); xhr.timeout = 120000;
      const fail = (message: string) => { active.current = false; setPhase("idle"); setError(message); };
      xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
      xhr.upload.onload = () => { setProgress(100); setPhase("checking"); };
      xhr.onerror = () => fail("Connection interrupted. Retry with the same screenshot; duplicate submissions are protected.");
      xhr.ontimeout = () => fail("Submission took too long. Retry with the same screenshot or check My Orders before submitting a different receipt.");
      xhr.onload = () => {
        let result; try { result = JSON.parse(xhr.responseText); } catch { fail("The service could not confirm submission. Retry with the same screenshot."); return; }
        if (xhr.status < 200 || xhr.status >= 300) { fail(result.code === "INVALID_REQUEST" ? "Use a readable PNG or JPEG screenshot up to 4 MB. Other types and damaged images cannot be accepted." : typeof result.message === "string" ? result.message : "Submission could not be completed. Please retry."); return; }
        if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/i.test(result.id) || result.submitted !== true) { fail("Submission could not be confirmed. Check My Orders before retrying."); return; }
        setPhase("success"); router.replace(`/checkout/confirmation/${result.id}`); router.refresh();
      };
      xhr.send(form);
    }}>
      <label className="checkout-upload-label" htmlFor="checkout-proof">Payment screenshot <span>Required · PNG / JPEG · up to 4 MB</span></label>
      <input ref={inputRef} id="checkout-proof" name="proof" type="file" accept="image/png,image/jpeg" required disabled={pending} aria-describedby="checkout-upload-help" onChange={event => {
        const next = event.target.files?.[0] ?? null; clearSelection("", false);
        if (!next) return;
        if (!["image/png", "image/jpeg"].includes(next.type) || !next.size || next.size > MAX_PAYMENT_PROOF_BYTES) { event.target.value = ""; setError("Choose a PNG or JPEG screenshot up to 4 MB."); return; }
        previewRef.current = URL.createObjectURL(next); setPreview(previewRef.current); setFile(next);
      }} />
      {preview && <><div className="checkout-proof-preview"><Image src={preview} alt="Your selected payment screenshot" width={400} height={150} unoptimized onError={() => { if (!active.current) clearSelection("This screenshot could not be opened. Choose a readable PNG or JPEG."); }} /></div><div className="checkout-proof-actions"><Button type="button" variant="secondary" disabled={pending} onClick={() => inputRef.current?.click()}>Change Screenshot</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => clearSelection()}>Remove</Button></div></>}
      <p id="checkout-upload-help" className="checkout-help">Stored privately. Never include wallet passwords or access codes.</p>
      {pending && <div role="status">{phase === "success" ? "Screenshot submission confirmed. Opening your order status…" : <><label htmlFor="checkout-upload-progress">{phase === "uploading" ? `Uploading screenshot · ${progress}%` : "Validating screenshot and submitting for review…"}</label><progress id="checkout-upload-progress" max={100} value={progress} /></>}</div>}
      {error && <div role="alert" className="checkout-error"><p>{error}</p><Link href="/plans" className="text-link">Review current plans</Link><Link href="/dashboard/orders" className="text-link">Check My Orders</Link></div>}
      <Button type="submit" disabled={!file || pending}>{phase === "success" ? "Opening Order…" : pending ? "Submitting…" : "Submit Payment for Review"}</Button>
      <p className="checkout-help">Submission is not payment approval. Metro reviews your payment before VPN activation. Pay only once.</p>
    </form>
  </section>;
}
