"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitAuth } from "@/features/auth/client";

export function ProfileNameForm({ name }: { name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const value = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!value) { setMessage("Enter your display name."); return; }
    setPending(true); setMessage(null);
    const error = await submitAuth("update-user", { name: value });
    setMessage(error ?? "Your display name has been updated."); setPending(false);
    if (!error) router.refresh();
  }
  return <form onSubmit={submit} className="mt-6 max-w-md" aria-label="Update display name" aria-busy={pending}>
    <div className="form-field"><label htmlFor="profile-name">Display name</label><Input id="profile-name" name="name" defaultValue={name} required maxLength={80} autoComplete="name" disabled={pending} aria-describedby="profile-name-help" /></div>
    <p id="profile-name-help" className="mb-4 text-xs leading-6 text-muted-foreground">A recent sign-in is required. This changes your name only; it does not grant account permissions.</p>
    <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save display name"}</Button>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </form>;
}
