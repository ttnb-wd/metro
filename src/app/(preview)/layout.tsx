import { SplitDock } from "@/components/navigation/split-dock";
import { Footer } from "@/components/navigation/footer";

// Intentionally public UI previews. No session or authorization is implemented.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <><SplitDock /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
