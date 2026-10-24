"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitAuth } from "@/features/auth/client";

export function PasswordRecoveryForm({ reset = false }: { reset?: boolean }) {
  const token = useRef("");
  const started = useRef(false);
  const [ready, setReady] = useState(!reset), [usable, setUsable] = useState(false);
  const [pending, setPending] = useState(false), [success, setSuccess] = useState(false);
  const [visible, setVisible] = useState(false), [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (!reset || started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get("token");
    window.history.replaceState(null, "", window.location.pathname);
    token.current = fragment.getAll("token").length === 1 && value && /^[A-Za-z0-9_-]{24,256}$/.test(value) ? value : "";
    void Promise.resolve().then(() => { setUsable(Boolean(token.current)); setReady(true); });
  }, [reset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown || reset && !token.current) return;
    const form = event.currentTarget, values = new FormData(form);
    if (reset && values.get("password") !== values.get("confirm")) { setError("The passwords do not match."); return; }
    setPending(true); setError(null);
    const failure = reset
      ? await submitAuth("reset-password", { token: token.current, newPassword: String(values.get("password") ?? "") })
      : await submitAuth("request-password-reset", { email: String(values.get("email") ?? "").trim().toLowerCase(), redirectTo: "/reset-password" });
    setPending(false);
    if (failure) { setError(failure); return; }
    form.reset(); setSuccess(true);
    if (reset) token.current = "";
    else setCooldown(60);
  }

  return <div className="auth-page"><div className="auth-heading"><span className="preview-badge">YOUR METRO ACCOUNT</span>
    <h1>{reset ? "Choose a new password." : "Forgot your password?"}</h1>
    <p>{reset ? "Use a unique password with 12–128 characters." : "Request a secure link to recover your account."}</p></div>
    <div className="auth-card">
      {reset && !ready ? <p role="status">Checking your reset link…</p> : reset && !usable ? <p role="alert" className="auth-message">This reset link is missing or invalid. <Link className="text-link" href="/forgot-password">Request a new link</Link>.</p> : <>
        {success && <p role="status" className="auth-message mb-5">{reset ? "Your password has been reset. Your existing sessions are signed out. Log in with your new password." : "If this address has a Metro account, check your inbox and spam folder for a reset link. Links expire in 15 minutes."}</p>}
        {!(reset && success) && <form onSubmit={submit} aria-label={reset ? "Reset Metro password" : "Request Metro password reset"} aria-busy={pending}>
          <fieldset disabled={pending}><legend className="sr-only">Password recovery</legend>
            {!reset ? <div className="form-field"><label htmlFor="recovery-email">Email address</label><Input id="recovery-email" name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} /></div> : <>
              <div className="form-field"><label htmlFor="recovery-password">New password</label><div className="password-field"><Input id="recovery-password" name="password" type={visible ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" />
                <button type="button" className="password-toggle" onClick={() => setVisible(v => !v)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div></div>
              <div className="form-field"><label htmlFor="recovery-confirm">Confirm new password</label><Input id="recovery-confirm" name="confirm" type={visible ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" /></div>
            </>}
            <Button className="w-full" type="submit" disabled={pending || cooldown > 0}>{pending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}{pending ? "Please wait…" : cooldown ? `Request another link in ${cooldown}s` : reset ? "Reset password" : "Send reset link"}</Button>
          </fieldset>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="auth-message mt-5">{error}</p>}
        </form>}
      </>}
      <p className="auth-switch"><Link className="text-link" href="/login">Back to log in</Link></p>
    </div></div>;
}
