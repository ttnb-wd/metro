import { SplitDock } from "@/components/navigation/split-dock";
import { Footer } from "@/components/navigation/footer";

export const dynamic = "force-dynamic";

// Every child page validates its session server-side. Commerce/service areas
// remain UI previews even though the website account is now real.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <><SplitDock /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></>;
}
