import { PublicNavigation } from "@/components/navigation/public-navigation";
import { Footer } from "@/components/navigation/footer";

export const dynamic = "force-dynamic";

// Every child page validates its session server-side. Commerce/service areas
// use real website commerce and authoritative service data.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <><PublicNavigation /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
