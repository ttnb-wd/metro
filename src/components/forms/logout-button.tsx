"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { submitAuth } from "@/features/auth/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div><Button variant="secondary" disabled={pending} onClick={async () => {
    setPending(true); setError(null);
    const failure = await submitAuth("sign-out", {});
    if (failure) { setError(failure); setPending(false); return; }
    router.replace("/login"); router.refresh();
  }}>{pending ? "Signing out…" : "Log out"}</Button>{error && <p role="alert" className="mt-3 text-xs leading-6">{error}</p>}</div>;
}
