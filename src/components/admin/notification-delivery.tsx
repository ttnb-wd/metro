import { adminPage, getAdminRepository } from "@/server/admin";
export async function NotificationDeliveryReview() {
  const rows = await adminPage(async () => (await getAdminRepository()).notificationDelivery());
  if (!rows.length) return null;
  return <section className="admin-panel"><h2>Email delivery needs attention</h2><p>Temporary failures retry safely. Uncertain SMTP acceptance is held for delivery review to avoid duplicate messages.</p><ul>{rows.map(row => <li key={row.id}><strong>{row.user.email}</strong> · {row.kind.replaceAll("_", " ")} · {row.emailState} · {row.emailAttempts} attempts{row.emailErrorCode && ` · ${row.emailErrorCode}`}</li>)}</ul></section>;
}
