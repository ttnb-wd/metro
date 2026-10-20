"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitAuth } from "@/features/auth/client";

type VerificationState = "pending" | "verifying" | "success" | "expired" | "invalid" | "unavailable";
export function VerificationForm({ returnTo }: { returnTo: string }) {
  const [state, setState] = useState<VerificationState>("pending");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) messageRef.current?.focus(); }, [message]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // Remove credentials from browser history before any request or navigation.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token) return;
    async function confirm() {
      setState("verifying");
      try {
        const response = await fetch("/api/auth/verify-email", { method: "POST", credentials: "same-origin", redirect: "error",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        if (response.ok) { setState("success"); return; }
        const result: unknown = await response.json().catch(() => null);
        const code = result && typeof result === "object" ? (result as { error?: { code?: string } }).error?.code : undefined;
        setState(code === "VERIFICATION_EXPIRED" ? "expired" : response.status === 429 || response.status >= 500 ? "unavailable" : "invalid");
      } catch { setState("unavailable"); }
    }
    void confirm();
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || cooldown) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    setSending(true); setMessage(null);
    const failure = await submitAuth("send-verification-email", { email, callbackURL: "/verify-email" });
    setMessage(failure ?? "If this address has an unverified Metro account, a verification email has been sent. Check your inbox and spam folder.");
    if (!failure || failure.startsWith("Too many")) setCooldown(60);
    setSending(false);
  }
  const content = {
    pending: ["Check your inbox.", "Open your Metro verification email to confirm your address. Links expire after 60 minutes. Already registered? Request a new link below."],
    verifying: ["Verifying your email…", "Please keep this page open while Metro confirms your verification link."],
    success: ["Your email is verified.", "You can now sign in to your Metro account."],
    expired: ["This link has expired.", "Request a new verification email below. Your account is still available."],
    invalid: ["This link could not be verified.", "The link is invalid or incomplete. Request a new verification email below."],
    unavailable: ["Verification is temporarily unavailable.", "Wait a minute, then reopen the link from your email or request a new one below."],
  }[state];
  return <div className="auth-page"><div className="auth-heading"><span className="preview-badge">YOUR METRO ACCOUNT</span>
    <h1>{content[0]}</h1><p role="status" aria-live="polite">{content[1]}</p></div>
    <div className="auth-card">
      {state === "verifying" ? <div className="flex min-h-24 items-center justify-center" aria-label="Verifying email"><LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /></div>
        : state === "success" ? <Button asChild className="w-full"><Link href={`/login?verified=1&next=${encodeURIComponent(returnTo)}`}>Continue to log in</Link></Button>
          : <form onSubmit={resend} aria-label="Resend verification email" aria-busy={sending}>
            <div className="form-field"><label htmlFor="verification-email">Email address</label><Input id="verification-email" name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" disabled={sending} /></div>
            <Button type="submit" className="w-full" disabled={sending || cooldown > 0}>{sending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}{sending ? "Sending verification email…" : cooldown ? `Resend in ${cooldown}s` : "Resend verification email"}</Button>
            {message && <p ref={messageRef} role="status" tabIndex={-1} className="auth-message mt-5">{message}</p>}
          </form>}
      {state !== "success" && <p className="auth-switch"><Link className="text-link" href={`/login?next=${encodeURIComponent(returnTo)}`}>Back to log in</Link></p>}
    </div><p className="mt-5 text-center text-xs leading-6 text-muted-foreground">Only verify links you requested. Verification does not purchase or activate a service.</p>
    <noscript><p className="auth-message mt-5">Enable JavaScript to submit your secure verification link or request another email.</p></noscript>
  </div>;
}
