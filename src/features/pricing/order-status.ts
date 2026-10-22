/** Read the durable operation for in-flight work; the order snapshot can still
 * say QUEUED while the separate worker is processing the operation. */
export function currentProvisioning(order: { payment: string; provisioning: string }, operationState?: string): string {
  return order.payment === "CONFIRMED" && operationState && ["QUEUED", "PROCESSING", "RETRY_PENDING", "REVIEW_REQUIRED", "SUCCEEDED"].includes(operationState) ? operationState : order.provisioning;
}

export function customerOrderStatus(order: { payment: string; provisioning: string; state: string }) {
  if (order.state === "CANCELLED") return { title: "Order cancelled", message: "No VPN activation is being requested for this order." };
  if (order.payment === "UNVERIFIED") return { title: "Draft · payment not submitted", message: "Your price is saved, but no payment proof has been submitted. This draft is not awaiting OWNER approval." };
  if (order.payment === "REJECTED") return { title: "Payment proof needs attention", message: "Review Metro’s feedback and submit corrected proof. Do not send another payment without checking your original transaction." };
  if (order.payment === "UNDER_REVIEW") return { title: "Payment Under Review", message: "Your payment is under review. Once approved, your VPN access will be activated automatically." };
  if (order.payment !== "CONFIRMED") return { title: "Awaiting payment", message: "Pay the exact agreed amount, then upload your receipt for review." };
  if (order.provisioning === "SUCCEEDED" && order.state === "COMPLETE") return { title: "VPN activation completed", message: "Your payment was approved and the service was activated. Open Secure Access for its current status, private key and setup instructions." };
  if (order.provisioning === "REVIEW_REQUIRED" || order.state === "REVIEW_REQUIRED") return { title: "Payment approved · activation needs attention", message: "Metro needs to review an activation problem. Your payment remains recorded. Do not pay again; the existing operation can be recovered safely." };
  if (order.provisioning === "RETRY_PENDING") return { title: "Payment approved · activation retry pending", message: "Activation could not be completed yet. The same durable request will be retried. Your payment remains confirmed; do not pay again." };
  return { title: order.provisioning === "PROCESSING" ? "Payment approved · activating VPN" : "Payment approved · activation queued", message: "Your VPN activation is being processed. This page refreshes automatically. Do not submit another payment." };
}
