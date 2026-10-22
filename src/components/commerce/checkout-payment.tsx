"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PaymentInstructions } from "./payment-instructions";
import { CheckoutSubmit } from "./checkout-submit";
import type { PaymentMethod } from "@/server/commerce/config";

type Preparation = { status: "preparing" } | { status: "ready"; orderId: string } | { status: "error"; message: string };
export function CheckoutPayment({ token, method, totalMmk, orderId }: { token: string; method: PaymentMethod; totalMmk: string; orderId?: string }) {
  const router = useRouter(), requestKey = useRef<string | null>(null);
  const [state, setState] = useState<Preparation>(orderId ? { status: "ready", orderId } : { status: "preparing" }), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (orderId) return;
    const controller = new AbortController(); requestKey.current ??= crypto.randomUUID();
    void (async () => {
      try {
        const response = await fetch("/api/checkout/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, requestKey: requestKey.current }), cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "We could not prepare your checkout. Please retry.");
        if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/i.test(result.id) || result.totalMmk !== totalMmk) throw new Error("Your selection changed. Review the current plans before paying.");
        if (!result.ready) { router.replace(`/dashboard/orders/${result.id}`); return; }
        // The owned draft URL survives refresh and later catalog edits without
        // creating another draft or changing the amount already shown for payment.
        router.replace(`/checkout?draft=${result.id}`);
        if (!controller.signal.aborted) setState({ status: "ready", orderId: result.id });
      } catch (error) { if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Checkout is temporarily unavailable." }); }
    })();
    return () => controller.abort();
  }, [token, totalMmk, orderId, retry, router]);
  if (state.status !== "ready") return <section className="checkout-card" aria-live="polite" aria-busy={state.status === "preparing"}>{state.status === "preparing" ? <p>Securing your price before payment…</p> : <><p role="alert">{state.message}</p><Button type="button" variant="secondary" onClick={() => { setState({ status: "preparing" }); setRetry(value => value + 1); }}>Retry checkout</Button><p><a href="/plans" className="text-link">Review current plans →</a></p></>}</section>;
  return <div className="checkout-columns"><PaymentInstructions method={method} totalMmk={totalMmk} compact /><CheckoutSubmit orderId={state.orderId} /></div>;
}
