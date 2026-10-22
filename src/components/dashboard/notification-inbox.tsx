import { formatMyanmarTime } from "@/lib/myanmar-time";
import Link from "next/link";
import { getWebsiteRepositories } from "@/server/website";
import { NotificationReadButton } from "./notification-read-button";
export async function NotificationInbox() {
  const data = await (await getWebsiteRepositories()).notifications();
  return <section className="workspace-panel admin-panel notification-inbox"><h2>Notifications {data.enabled && <span>· {data.unread} unread</span>}</h2>{!data.enabled ? <p>Notification delivery is awaiting database and worker activation. Your services and support remain available.</p> : !data.items.length ? <p>No notifications yet. Service alerts and support updates will appear here.</p> : <ol className="metro-notifications">{data.items.map(item => <li key={item.id} className={item.readAt ? "is-read" : "is-unread"}><article><p className="workspace-small-label">{item.readAt ? "Read" : "Unread"} · <time dateTime={item.createdAt.toISOString()}>{formatMyanmarTime(item.createdAt)}</time></p><h3>{item.payload.title}</h3><p>{item.payload.message}</p><p className="workspace-small-label">Recorded status at {formatMyanmarTime(item.payload.observedAt)}. Open your service for current status.</p><div className="workspace-access-actions"><Link href={item.href} className="text-link">{item.payload.action} →</Link><NotificationReadButton id={item.id} read={!!item.readAt} /></div></article></li>)}</ol>}</section>;
}
