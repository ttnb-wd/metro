"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { submitAuth } from "@/features/auth/client";
import { safeReturnPath } from "@/features/auth/redirects";

export function AuthForm({ mode, returnTo, registered = false, verified = false }: { mode: "login" | "register"; returnTo: string; registered?: boolean; verified?: boolean }) {
  const registering = mode === "register";
  const router = useRouter();
  const destination = safeReturnPath(returnTo);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (registering && !name) { setError("Enter your name to continue."); return; }
    setPending(true); setError(null);
    const failure = await submitAuth(registering ? "sign-up/email" : "sign-in/email", {
      ...(registering ? { name } : {}), email: String(data.get("email") ?? "").trim().toLowerCase(),
      password: String(data.get("password") ?? ""), ...(registering ? { callbackURL: "/verify-email" } : { callbackURL: destination, rememberMe: true }),
    });
    if (failure) { setError(failure); setPending(false); return; }
    router.replace(registering ? `/verify-email?next=${encodeURIComponent(destination)}` : `/account?next=${encodeURIComponent(destination)}`);
    router.refresh();
  }

  return <div className="auth-page"><div className="auth-heading"><span className="preview-badge">YOUR METRO ACCOUNT</span>
    <h1>{registering ? "Your Metro starts here." : "Welcome to Metro."}</h1>
    <p>{registering ? "One independent account for your digital essentials." : "Sign in to your dedicated Metro account."}</p></div>
    {registered && <p role="status" className="auth-message">Registration request received. Verify your email before signing in.</p>}
    {verified && <p role="status" className="auth-message">Email verification completed. Sign in to continue.</p>}
    <div className="auth-card"><form onSubmit={submit} aria-label={registering ? "Create Metro account" : "Log in to Metro"} aria-busy={pending}>
      <fieldset disabled={pending}><legend className="sr-only">{registering ? "Create your account" : "Your sign-in details"}</legend>
        {registering && <div className="form-field"><label htmlFor="name">Your name</label><Input id="name" name="name" required maxLength={80} autoComplete="name" placeholder="Your name" /></div>}
        <div className="form-field"><label htmlFor="email">Email address</label><Input id="email" name="email" type="email" required maxLength={254} placeholder="you@example.com" autoComplete="email" autoCapitalize="none" spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={error ? "auth-error" : undefined} /></div>
        <div className="form-field"><label htmlFor="password">Password</label><div className="password-field">
          <Input id="password" name="password" type={visible ? "text" : "password"} required minLength={registering ? 12 : undefined} maxLength={128}
            placeholder={registering ? "Create a password" : "Enter your password"} autoComplete={registering ? "new-password" : "current-password"}
            aria-invalid={error ? true : undefined} aria-describedby={registering ? "password-help" : error ? "auth-error" : undefined} />
          <button type="button" className="password-toggle" onClick={() => setVisible(value => !value)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
            {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div>
          {registering && <p id="password-help" className="text-xs leading-6 text-muted-foreground">Use 12–128 characters. A unique password or passphrase works well.</p>}</div>
        <Button type="submit" className="mt-1 w-full" disabled={pending}>{pending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}{pending ? (registering ? "Creating your account…" : "Signing in…") : registering ? "Create account" : "Log in"}</Button>
      </fieldset>
      {error && <p ref={errorRef} id="auth-error" role="alert" tabIndex={-1} className="auth-message mt-5">{error}</p>}
    </form>{!registering && <p className="mt-5 text-sm"><Link className="text-link" href={`/verify-email?next=${encodeURIComponent(destination)}`}>Verify your email or resend a link</Link></p>}<p className="auth-switch">{registering ? "Already have an account?" : "New to Metro?"} <Link className="text-link ml-1" href={`${registering ? "/login" : "/register"}?next=${encodeURIComponent(destination)}`}>{registering ? "Log in" : "Create account"}</Link></p></div>
    {registering && <p className="mt-5 text-center text-xs leading-6 text-muted-foreground">Registration creates a website account. It does not purchase or activate a service.</p>}
  </div>;
}
