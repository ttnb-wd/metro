"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export function PrivateEvidencePreview({ id }: { id: string }) {
  const [url, setUrl] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  const resource = useRef(""), active = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); if (resource.current) URL.revokeObjectURL(resource.current); }, []);
  return <div className="private-evidence-preview"><div className="workspace-access-actions"><Button type="button" size="sm" variant="secondary" className="min-h-11" disabled={pending} onClick={async () => {
    if (active.current) return;
    if (url) { URL.revokeObjectURL(resource.current); resource.current = ""; setUrl(""); return; }
    active.current = true; setPending(true); setError(""); controller.current = new AbortController();
    try {
      const response = await fetch(`/api/evidence/${id}?view=1`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.current.signal });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.message === "string" ? result.message : "This private screenshot could not be opened. Sign in again if your session has expired."); }
      const image = await response.blob(); if (image.type !== "image/png" || image.size > 5 * 1024 * 1024) throw new Error("The screenshot could not be displayed safely.");
      if (controller.current.signal.aborted) return;
      resource.current = URL.createObjectURL(image); setUrl(resource.current);
    } catch (failure) { if (!controller.current.signal.aborted) setError(failure instanceof Error ? failure.message : "Screenshot unavailable. Please retry."); }
    finally { active.current = false; setPending(false); }
  }}>{pending ? "Opening securely…" : url ? "Hide screenshot" : "Show screenshot"}</Button><a href={`/api/evidence/${id}`} className="text-link">Download proof</a></div>{error && <p role="alert">{error}</p>}{url && <Image src={url} unoptimized alt="Private payment screenshot for this order" width={800} height={900} />}</div>;
}
