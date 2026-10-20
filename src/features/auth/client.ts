"use client";

export async function submitAuth(path: "sign-in/email" | "sign-up/email" | "sign-out", body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error" });
    if (response.ok) return null;
    if (response.status === 429) return "Too many attempts. Please wait a minute and try again.";
    if (response.status === 401) return "Email or password is incorrect.";
    if (response.status === 403) return "This sign-in page is out of date. Reload the page and try again.";
    if (response.status === 503) return "Sign-in is temporarily unavailable. Please try again shortly.";
    return "We could not complete this request. Check your details and try again.";
  } catch { return "We could not reach Metro. Check your connection and try again."; }
}
