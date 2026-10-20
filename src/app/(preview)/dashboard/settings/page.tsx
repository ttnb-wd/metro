import { DashboardHeading } from "@/components/dashboard/dashboard-heading";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { Button } from "@/components/ui/button";

export default function SettingsPage() { return <><DashboardHeading title="Settings" description="A look at your future account preferences. Only the local color theme works today." /><section className="detail-panel"><h2>Your preferences</h2><div className="setting-row"><div><h3>Appearance</h3><p>Switch the theme on this browser.</p></div><ThemeToggle /></div><div className="setting-row"><div><h3>Email address</h3><p>No signed-in account. Profile editing is unavailable.</p></div><Button variant="secondary" disabled>Edit unavailable</Button></div><div className="setting-row"><div><h3>Password</h3><p>Authentication has not been implemented.</p></div><Button variant="secondary" disabled>Change unavailable</Button></div></section></>; }
