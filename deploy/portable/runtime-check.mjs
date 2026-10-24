// No provider selection or activation is performed here. The runtime receives
// an explicitly allowlisted web environment, never operator/worker credentials.
const env = process.env;
const missing = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "METRO_DATABASE_URL", "METRO_IMAGEKIT_PRIVATE_KEY", "METRO_IMAGEKIT_URL_ENDPOINT", "METRO_VPN_SERVICE_ORIGIN", "METRO_VPN_SERVICE_KEY_ID", "METRO_VPN_SERVICE_SECRET", "SMTP_USER", "SMTP_APP_PASSWORD", "METRO_AUTH_PROXY_SECRET"].filter(key => !env[key]);
const forbidden = ["METRO_DIRECT_DATABASE_URL", "METRO_COMMERCE_WORKER_DATABASE_URL", "METRO_NOTIFICATION_WORKER_DATABASE_URL", "METRO_EVIDENCE_DIRECTORY", "METRO_EVIDENCE_ENCRYPTION_KEY", "DATABASE_URL", "BOT_TOKEN", "AIVEN_DATABASE_URL"].filter(key => env[key]);
try {
  const origin = new URL(env.BETTER_AUTH_URL), db = new URL(env.METRO_DATABASE_URL);
  const flags = ["METRO_FULFILMENT_ENABLED", "METRO_VPN_EXECUTION_APPROVED", "METRO_VPN_FULFILMENT_RECEIPTS_VERIFIED"].map(key => env[key] === "true");
  if (missing.length || forbidden.length || env.VERCEL || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || env.METRO_AUTH_ENABLED !== "true" || env.METRO_WEBSITE_FOUNDATION_ENABLED !== "true" || env.METRO_DATABASE_RUNTIME_ROLE !== "metro_runtime"
    || !db.hostname.endsWith(".neon.tech") || !db.hostname.includes("-pooler.") || decodeURIComponent(db.username) !== "metro_runtime" || db.searchParams.get("sslmode") !== "verify-full"
    || env.METRO_EVIDENCE_PROVIDER !== "imagekit" || env.METRO_IMAGEKIT_FOLDER !== "/metro/payment-evidence"
    || !/^[a-f0-9]{64,128}$/i.test(env.METRO_AUTH_PROXY_SECRET) || new Set(env.METRO_AUTH_PROXY_SECRET.toLowerCase()).size < 12
    || flags.some(Boolean) && !flags.every(Boolean)) throw Error();
} catch { console.error("Metro web runtime configuration rejected; check the reviewed names-only environment contract."); process.exit(1); }
