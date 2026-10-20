import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/server/db/generated/client";
import type { EnabledAuthEnvironment } from "@/server/env";
import { createPgPoolConfig } from "@/server/db/connection-config";

const globalForMetro = globalThis as unknown as { metroPrisma?: PrismaClient };

export function getPrisma(environment: EnabledAuthEnvironment): PrismaClient {
  if (!environment.enabled) throw new Error("Metro database access is disabled.");
  if (globalForMetro.metroPrisma) return globalForMetro.metroPrisma;
  const adapter = new PrismaPg(createPgPoolConfig(environment.databaseUrl));
  const client = new PrismaClient({ adapter, log: [], errorFormat: "minimal" });
  globalForMetro.metroPrisma = client;
  // Neither this module nor its factory calls $connect or issues a query.
  return client;
}
