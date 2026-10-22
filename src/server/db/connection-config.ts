import "server-only";
import { Client, type ClientConfig, type PoolConfig } from "pg";
import { isLoopbackHost } from "@/server/env";

// pg 8 enables SCRAM-PLUS when offered, but does not interpret the URL's
// channel_binding=require. Record its native negotiation, without replacing
// any authentication/hash implementation, and reject fallback before use.
export class ChannelBindingClient extends Client {
  channelBindingNegotiated = false;

  constructor(config?: ClientConfig) {
    super(config);
    this.connection.once("authenticationSASLContinue", () => {
      const native = this as unknown as { saslSession?: { mechanism?: string } };
      this.channelBindingNegotiated = native.saslSession?.mechanism === "SCRAM-SHA-256-PLUS";
    });
  }
}

// Call only with a URL accepted by the server environment validator.
export function createPgPoolConfig(databaseUrl: string, serverless = process.env.VERCEL === "1"): PoolConfig {
  const url = new URL(databaseUrl);
  const tls = !isLoopbackHost(url.hostname) || url.searchParams.get("sslmode") === "verify-full";
  const channelBinding = url.searchParams.get("channel_binding");
  return {
    // Explicit fields avoid pg connectionString parameters overriding SSL.
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: tls ? { rejectUnauthorized: true, servername: url.hostname } : false,
    enableChannelBinding: channelBinding === "require" || channelBinding === "prefer",
    Client: ChannelBindingClient,
    onConnect: client => {
      if (channelBinding === "require" && !(client instanceof ChannelBindingClient && client.channelBindingNegotiated)) {
        throw new Error("PostgreSQL required channel binding was not negotiated.");
      }
    },
    application_name: url.searchParams.get("application_name") ?? "metro_website",
    max: serverless ? 3 : 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: serverless ? 5_000 : 30_000,
    ...(serverless ? { allowExitOnIdle: true, maxLifetimeSeconds: 60 } : {}),
  };
}
