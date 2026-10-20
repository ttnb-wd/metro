import { SplitDock } from "@/components/navigation/split-dock";
import { Footer } from "@/components/navigation/footer";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <><SplitDock /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
