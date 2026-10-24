// Offline deployment check. Emit only capability booleans, never environment
// values, identities, credentials, URLs or signed quotes. No database writes.
import { readServerEnvironment } from "../../src/server/env.ts";
import { paymentMethods, commerceEnabled, fulfilmentEnabled } from "../../src/server/commerce/config.ts";
import { evidenceStorageReady } from "../../src/server/commerce/evidence-store.ts";

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
