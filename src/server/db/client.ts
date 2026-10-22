import "server-only";
import { MetroPrismaPg } from "@/server/db/prisma-pg";
import { PrismaClient } from "@/server/db/generated/client";
import type { EnabledAuthEnvironment } from "@/server/env";
import { createPgPoolConfig } from "@/server/db/connection-config";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const globalForMetro = globalThis as unknown as { metroPrisma?: PrismaClient };

export function getPrisma(environment: EnabledAuthEnvironment): PrismaClient {
  if (!environment.enabled) throw new Error("Metro database access is disabled.");
  if (globalForMetro.metroPrisma) return globalForMetro.metroPrisma;
  const pool = new Pool(createPgPoolConfig(environment.databaseUrl));
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  const adapter = new MetroPrismaPg(pool, { disposeExternalPool: true });
  const client = new PrismaClient({ adapter, log: [], errorFormat: "minimal" });
  globalForMetro.metroPrisma = client;
  // Neither this module nor its factory calls $connect or issues a query.
  return client;
}
