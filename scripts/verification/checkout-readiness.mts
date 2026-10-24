// Emit only capability booleans, never credentials, identities or signed data.
// With execution enabled, verify the real API using its non-provisioning
// capability operation. This never approves an order or requests a VPN key.
import { readServerEnvironment } from "../../src/server/env.ts";
import { paymentMethods, commerceEnabled, fulfilmentEnabled } from "../../src/server/commerce/config.ts";
import { evidenceStorageReady } from "../../src/server/commerce/evidence-store.ts";
import { callVpnService } from "../../src/server/vpn/transport.ts";
import { z } from "zod";

let checkoutReady = false;
try {
  const env = readServerEnvironment();
  const checks = {
    authentication: env.enabled,
    foundation: env.enabled && env.foundationEnabled,
    paymentMethod: paymentMethods().length > 0,
    privateEvidence: evidenceStorageReady(),
    imageKitOnVercel: process.env.VERCEL !== "1" || process.env.METRO_EVIDENCE_PROVIDER === "imagekit",
  };
  checkoutReady = Object.values(checks).every(Boolean);
  console.log("METRO_CHECKOUT_READINESS " + JSON.stringify({
    ...checks, checkoutReady,
    previousCheckoutGate: commerceEnabled(),
    fulfilmentFlag: process.env.METRO_FULFILMENT_ENABLED === "true",
    vpnExecutionFlag: process.env.METRO_VPN_EXECUTION_APPROVED === "true",
    verifiedFulfilmentGate: fulfilmentEnabled(),
    environmentChanged: false,
  }));
} catch {
  console.error("METRO_CHECKOUT_READINESS: invalid server configuration; no values logged.");
}
if (!checkoutReady) process.exitCode = 1;
if (checkoutReady && fulfilmentEnabled()) {
  try {
    z.object({
      protocols: z.array(z.string()).refine(values => values.includes("metro-fulfilment-receipt.v1")),
      durableReplay: z.literal(true), completionTimestamp: z.literal(true),
      enforcement: z.literal("finite-rolling-window-with-lifetime-offset.v1"),
    }).parse(await callVpnService("capabilities", {}));
    console.log("METRO_VPN_EXECUTION_READINESS " + JSON.stringify({ signedHttpsAuthentication: true, receiptProtocol: true, durableReplay: true, finiteEnforcement: true, keyOperations: 0 }));
  } catch {
    console.error("METRO_VPN_EXECUTION_READINESS: receipt-capable backend verification failed; no credentials logged or key operation requested.");
    process.exitCode = 1;
  }
}
