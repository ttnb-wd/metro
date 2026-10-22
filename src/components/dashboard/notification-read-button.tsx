"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function NotificationReadButton({ id, read }: { id: string; read: boolean }) {
  const router = useRouter(), [pending, setPending] = useState(false), [error, setError] = useState("");
  return <><Button variant="ghost" disabled={pending} onClick={async () => { setPending(true); setError(""); try { const response = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, read: !read }) }); if (!response.ok) throw new Error(); router.refresh(); } catch { setError("Notification could not be updated. Try again."); } finally { setPending(false); } }}>{pending ? "Saving…" : read ? "Mark unread" : "Mark read"}</Button>{error && <p role="status">{error}</p>}</>;
}
