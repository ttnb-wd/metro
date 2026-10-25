"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export function PrivateEvidencePreview({ id }: { id: string }) {
  const [url, setUrl] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  const resource = useRef(""), active = useRef(false), controller = useRef<AbortController | null>(null);
  const clear = useCallback(() => { controller.current?.abort(); controller.current = null; if (resource.current) URL.revokeObjectURL(resource.current); resource.current = ""; active.current = false; setUrl(""); setPending(false); }, []);
  useEffect(() => { const hide = () => { if (document.hidden) clear(); }; document.addEventListener("visibilitychange", hide); return () => { controller.current?.abort(); controller.current = null; if (resource.current) URL.revokeObjectURL(resource.current); document.removeEventListener("visibilitychange", hide); }; }, [clear]);
  async function open() {
    if (active.current || document.hidden) return;
    if (url) { clear(); return; }
    const request = new AbortController(); controller.current = request; active.current = true; setPending(true); setError("");
    const current = () => controller.current === request && !request.signal.aborted && !document.hidden;
    try {
      const response = await fetch(`/api/evidence/${id}?view=1`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: request.signal });
      if (!current()) return;
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.message === "string" ? result.message : "This private screenshot could not be opened. Sign in again if your session has expired."); }
      const image = await response.blob();
      if (!current()) return;
      if (image.type !== "image/png" || image.size > 5 * 1024 * 1024) throw new Error("The screenshot could not be displayed safely.");
      resource.current = URL.createObjectURL(image); setUrl(resource.current);
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : "Screenshot unavailable. Please retry."); }
    finally { if (controller.current === request) { controller.current = null; active.current = false; setPending(false); } }
  }
  return <div className="private-evidence-preview"><div className="workspace-access-actions"><Button type="button" size="sm" variant="secondary" className="min-h-11" disabled={pending} onClick={() => void open()}>{pending ? "Opening securely…" : url ? "Hide screenshot" : "Show screenshot"}</Button><a href={`/api/evidence/${id}`} className="text-link">Download proof</a></div>{error && <p role="alert">{error}</p>}{url && <Image src={url} unoptimized alt="Private payment screenshot for this order" width={800} height={900} />}</div>;
}
