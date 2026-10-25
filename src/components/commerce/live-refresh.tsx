"use client";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
export function LiveRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter(), last = useRef(0), [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      const now = performance.now();
      // Focus and visibility often arrive together. Avoid duplicate RSC/API
      // waterfalls, concurrent refreshes, and disturbing active payment forms.
      if (document.hidden || pending || document.activeElement?.closest("form") || now - last.current < 15_000) return;
      last.current = now; startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled, router, pending]);
  return null;
}
