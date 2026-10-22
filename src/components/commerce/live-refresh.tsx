"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function LiveRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (!document.hidden && !document.activeElement?.closest("form")) router.refresh(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled, router]);
  return null;
}
