import { requireWebsiteSession } from "@/server/auth/session";
import { NotificationInbox } from "@/components/dashboard/notification-inbox";
export default async function NotificationsPage() { await requireWebsiteSession("/dashboard/notifications"); return <><header><p className="workspace-small-label">YOUR WORKSPACE</p><h1>Notifications</h1><p>Service alerts and updates from Metro support.</p></header><NotificationInbox /></>; }
