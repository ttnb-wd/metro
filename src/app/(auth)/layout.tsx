import { PublicNavigation } from "@/components/navigation/public-navigation";
import { Footer } from "@/components/navigation/footer";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <><PublicNavigation /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
