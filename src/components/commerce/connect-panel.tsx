"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function ServiceRefreshButton({ label = "Refresh service status" }: { label?: string }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  return <Button variant="ghost" disabled={pending} aria-busy={pending} aria-label={label} onClick={() => startTransition(() => router.refresh())}>{pending ? "Refreshing…" : label === "Refresh service status" ? "Refresh status" : label}</Button>;
}
type ConnectPanelProps = { serviceId: string; admin?: boolean; available?: boolean; unavailableReason?: string };
export function ConnectPanel(props: ConnectPanelProps) {
  // A change in access eligibility discards all previously revealed state.
  return <PrivateConnectionPanel key={`${props.serviceId}:${props.available === true}:${props.admin === true}`} {...props} />;
}
function PrivateConnectionPanel({ serviceId, admin = false, available = false, unavailableReason }: ConnectPanelProps) {
  const [key, setKey] = useState(""), [message, setMessage] = useState(""), [pending, setPending] = useState(false), [recovery, setRecovery] = useState(false);
  const controller = useRef<AbortController | null>(null), busy = useRef(false);
  const clear = useCallback(() => { controller.current?.abort(); controller.current = null; busy.current = false; setKey(""); setPending(false); }, []);
  useEffect(() => { const hide = () => { if (document.hidden) clear(); }; document.addEventListener("visibilitychange", hide); return () => { controller.current?.abort(); controller.current = null; document.removeEventListener("visibilitychange", hide); }; }, [clear]);
  useEffect(() => { if (!key) return; const timer = setTimeout(clear, 60_000); return () => clearTimeout(timer); }, [key, clear]);
  async function reveal(action: "show" | "copy" | "open" = "show") {
    if (busy.current || !available || document.hidden) return;
    const request = new AbortController(); controller.current = request; busy.current = true;
    const current = () => controller.current === request && !request.signal.aborted && !document.hidden;
    setPending(true); setMessage(""); setKey(""); setRecovery(false);
    try {
      const response = await fetch(`/api/services/${serviceId}/credential`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ admin }), cache: "no-store", credentials: "same-origin", redirect: "error", signal: request.signal });
      const result = await response.json().catch(() => ({}));
      if (!current()) return;
      if (!response.ok) { setRecovery(result.topUp === true || result.renew === true); throw new Error(typeof result.message === "string" ? result.message : "Current VPN status is unavailable. Refresh and try again."); }
      if (typeof result.credential !== "string" || !/^ss:\/\/\S+$/.test(result.credential)) throw new Error("No verified native key is available.");
      setKey(result.credential);
      if (action === "open") window.location.href = result.credential;
      if (action === "copy") { try { await navigator.clipboard.writeText(result.credential); if (current()) setMessage("Key copied. Open Outline and choose Add server."); } catch { if (current()) setMessage("Select and copy the verified key manually."); } }
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "Connection details are unavailable. Please retry."); }
    finally { if (controller.current === request) { controller.current = null; busy.current = false; setPending(false); } }
  }
  const visibleKey = available ? key : "";
  return <section className="connection-panel" aria-label="Private connection details"><div><h3>Connection details</h3><p>Your key stays hidden until you request it. Each action verifies current access.</p></div>{!available && <p>{unavailableReason ?? "Private key delivery is temporarily unavailable."}</p>}<div className="connection-controls"><Button variant="secondary" disabled={pending || !available} aria-label={visibleKey ? "Hide key" : admin ? "Securely reveal customer key" : "Show connection key"} onClick={visibleKey ? clear : () => void reveal()}>{pending ? "Checking access…" : visibleKey ? "Hide key" : admin ? "Securely reveal customer key" : "Show key"}</Button><ServiceRefreshButton /></div>{visibleKey && <><label>Native Outline key<textarea readOnly value={visibleKey} spellCheck={false} autoComplete="off" /></label><div className="connection-controls"><Button disabled={pending} onClick={() => void reveal("copy")}>Copy key</Button><Button disabled={pending} variant="secondary" onClick={() => void reveal("open")}>Open Outline</Button></div><p>Hidden after one minute or when you leave this tab. If import is blocked, copy the key and choose Add server in Outline. Metro cannot confirm your device’s connection state.</p></>}{message && <p role="status">{message}</p>}{recovery && !admin && <a href="/plans" className="text-link">Top up or renew →</a>}<a href="/setup" className="text-link">Device setup instructions →</a></section>;
}
