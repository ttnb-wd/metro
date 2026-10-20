import { SplitDock } from "@/components/navigation/split-dock";
import { Footer } from "@/components/navigation/footer";
import "@/styles/public-experience.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <><SplitDock /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
