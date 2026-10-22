import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/page-intro";
import { PricingCalculator } from "@/components/plans/pricing-calculator";
import { getPublicPricing } from "@/server/pricing";

export const metadata: Metadata = { title: "Secure Access plans" };

export default async function PlansPage() {
  const state = await getPublicPricing();
  return <div className="page-container content-page public-refinement plans-page"><PageIntro eyebrow="SECURE ACCESS / WEBSITE PLANS" title="Your package. Your pace."><p>Compare Metro’s published website packages and available durations from 1 to 12 months. Every subscription month is exactly 30 days.</p></PageIntro><PricingCalculator key={state.status === "READY" ? state.release.version : state.status} state={state} /></div>;
}
