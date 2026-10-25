import Link from "next/link";
import { getWebsiteRepositories } from "@/server/website";
export async function SupportUpdates() {
  const issues = (await (await getWebsiteRepositories()).listIssues()).filter(issue => issue.events.length > 1);
  if (!issues.length) return null;
  return <section className="workspace-panel workspace-panel-padded"><h2>Support updates</h2><ul className="commerce-orders">{issues.map(issue => <li key={issue.id}><p>{issue.state === "TROUBLESHOOTING" ? "Support tested your key successfully. Follow your next guided connection attempt." : issue.state.replaceAll("_", " ")}</p><Link href="/dashboard/secure-access" className="text-link">Read your support update →</Link></li>)}</ul></section>;
}
