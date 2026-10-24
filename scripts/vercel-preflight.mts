// Offline only. No credentials, URLs, database queries, uploads or mail delivery
// are printed or performed by this deployment configuration check.
import { parseServerEnvironment } from "../src/server/env.ts";
import { evidenceStorageReady } from "../src/server/commerce/evidence-store.ts";
import { readSmtpEnvironment } from "../src/server/email/verification.ts";
import { serviceConfigured } from "../src/server/vpn/transport.ts";
import { paymentMethods } from "../src/server/commerce/config.ts";

const source: NodeJS.ProcessEnv = { ...process.env, VERCEL: "1", NODE_ENV: "production" };
const checks: Record<string, boolean> = {};
try { checks.authentication = parseServerEnvironment(source).enabled; } catch { checks.authentication = false; }
checks.privateImageKitStorage = source.METRO_EVIDENCE_PROVIDER === "imagekit" && evidenceStorageReady(source);
try { readSmtpEnvironment(source); checks.smtpConfiguration = true; } catch { checks.smtpConfiguration = false; }
checks.vpnServiceConfiguration = serviceConfigured(source);
checks.verifiedFulfilmentReceipts = source.METRO_VPN_FULFILMENT_RECEIPTS_VERIFIED === "true";
checks.websitePaymentMethods = paymentMethods(source).length > 0;
checks.noLocalEvidenceDependency = !source.METRO_EVIDENCE_DIRECTORY && !source.METRO_EVIDENCE_ENCRYPTION_KEY;
console.log(JSON.stringify({ checks, result: Object.values(checks).every(Boolean) ? "PASS" : "BLOCKED", offlineOnly: true,
  hostingEligibility: "Separate written Vercel VPN-storefront eligibility confirmation and a commercial plan are required; this check cannot grant provider approval." }));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
