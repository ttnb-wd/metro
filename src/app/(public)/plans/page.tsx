import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/page-intro";
import { PricingCalculator } from "@/components/plans/pricing-calculator";

export const metadata: Metadata = { title: "Secure Access plans" };

export default function PlansPage() {
  return <div className="page-container content-page public-refinement plans-page"><PageIntro eyebrow="SECURE ACCESS / PLAN PROTOTYPE" title="Your package. Your pace."><p>Compare data packages and durations from 1 to 12 months. Each month is 30 days, with a larger duration discount as you add months.</p></PageIntro><PricingCalculator /></div>;
}
