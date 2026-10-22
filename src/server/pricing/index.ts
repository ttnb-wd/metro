import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { readServerEnvironment } from "../env";
import { foundationDatabase } from "../website";
import { readPricing, buildPricingRepository } from "./store";
import { calculateWebsiteQuote, type PricingState } from "@/features/pricing/catalog";
import { FoundationError } from "../owner/authorization";

// Request-scoped only. Public prices never live in a process-wide cache.
export const getPublicPricing = cache(async (): Promise<PricingState> => {
  await connection();
  try {
    const env = readServerEnvironment();
    if (!env.enabled || !env.foundationEnabled) return { status: "UNAVAILABLE" };
    const state = await readPricing(await foundationDatabase());
    return state.status === "READY" ? { ...state, release: { ...state.release, catalog: { ...state.release.catalog, packages: state.release.catalog.packages.filter(pkg => pkg.active) } } } : state;
  } catch { return { status: "UNAVAILABLE" }; }
});

export async function getPricingRepository() { return buildPricingRepository(await foundationDatabase()); }
export async function getServerQuote(selection: unknown) {
  const state = await getPublicPricing();
  if (state.status !== "READY") throw new FoundationError("UNAVAILABLE");
  return calculateWebsiteQuote(state.release, selection);
}
