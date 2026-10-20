import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PreviewNotice } from "@/components/preview/preview-notice";

export function AuthPreview({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  return <div className="auth-page"><div className="auth-heading"><span className="preview-badge">Account experience / Preview</span><h1>{registering ? "Your Metro starts here." : "Welcome to Metro."}</h1><p>{registering ? "One independent account for your digital essentials." : "A dedicated place for your digital essentials."}</p></div>
    <PreviewNotice>Authentication is not connected. These fields are disabled, and no credentials can be entered or submitted.</PreviewNotice>
    <div className="auth-card"><form aria-label={registering ? "Registration layout preview" : "Login layout preview"}><fieldset disabled><legend className="sr-only">Account form preview — unavailable</legend>
      <div className="form-field"><label htmlFor="email">Email address</label><Input id="email" type="email" placeholder="you@example.com" autoComplete="off" aria-describedby="auth-unavailable" /></div>
      <div className="form-field"><label htmlFor="password">Password</label><Input id="password" type="password" placeholder={registering ? "Create a password" : "Enter your password"} autoComplete="off" /></div>
      <Button type="button" disabled className="mt-1 w-full">{registering ? "Create account — coming later" : "Log in — coming later"}</Button>
    </fieldset><p id="auth-unavailable" className="mt-4 text-xs leading-6 text-muted-foreground">Email and password authentication will be added in a later step.</p></form>
    <p className="auth-switch">{registering ? "Already have an account?" : "New to Metro?"} <Link className="text-link ml-1" href={registering ? "/login" : "/register"}>{registering ? "Log in preview" : "Create account preview"}</Link></p></div>
    <div className="mt-5 text-center"><Link className="text-link gap-2 text-xs" href="/dashboard">Explore the dashboard preview <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
  </div>;
}
