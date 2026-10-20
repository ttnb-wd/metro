"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AuthError({ retry }: { retry: () => void }) {
  return <div className="page-container content-page"><section className="detail-panel" role="alert">
    <h1 className="font-display text-3xl">Your account is temporarily unavailable.</h1>
    <p>We could not securely load your account. Please try again shortly.</p>
    <div className="mt-6 flex flex-wrap gap-4"><Button onClick={() => retry()}>Try again</Button>
      <Button variant="secondary" asChild><Link href="/">Back to Metro</Link></Button></div>
  </section></div>;
}
