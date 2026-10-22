import Link from "next/link";
import { getPublicPricing } from "@/server/pricing";
import { formatWebsiteMmk } from "@/features/pricing/catalog";

export async function PublishedPricing({ compact = false }: { compact?: boolean }) {
  const state = await getPublicPricing();
  const packages = state.status === "READY" ? state.release.catalog.packages : [];
  const available = packages.length > 0 && state.status === "READY" && state.release.catalog.durations.some(item => item.active);
  return <div className={compact ? "published-pricing-compact" : "published-pricing"}>
    {available ? <><span>Secure Access · {packages.length} {packages.length === 1 ? "package" : "packages"}</span><strong>Base prices from {formatWebsiteMmk(packages.reduce((min, pkg) => BigInt(pkg.monthlyPriceMmk) < BigInt(min) ? pkg.monthlyPriceMmk : min, packages[0].monthlyPriceMmk))} / 30 days</strong><Link href="/plans">Compare website plans ↗</Link></> : <><span>Secure Access</span><strong>Website packages are being prepared.</strong><Link href="/plans">Plan availability ↗</Link></>}
  </div>;
}
