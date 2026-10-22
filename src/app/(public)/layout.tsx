import { PublicNavigation } from "@/components/navigation/public-navigation";
import { Footer } from "@/components/navigation/footer";
import "@/styles/public-experience.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <><PublicNavigation /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
