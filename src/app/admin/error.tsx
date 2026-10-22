"use client";
import { Button } from "@/components/ui/button";
export default function AdminError({ reset }: { reset: () => void }) {
  return <div className="admin-empty"><h1>Administration is temporarily unavailable.</h1><p>Your request could not be completed. Please retry, or sign in again if your session expired.</p><Button onClick={reset}>Try again</Button></div>;
}
