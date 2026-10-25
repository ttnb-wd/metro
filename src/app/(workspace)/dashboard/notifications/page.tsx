import { requireWebsiteSession } from "@/server/auth/session";
import { NotificationInbox } from "@/components/dashboard/notification-inbox";
import { PageHeading } from "@/components/dashboard/workspace-components";
export default async function NotificationsPage() { await requireWebsiteSession("/dashboard/notifications"); return <><PageHeading eyebrow="YOUR WORKSPACE" title="Notifications" description="Service alerts and updates from Metro support." /><NotificationInbox /></>; }
