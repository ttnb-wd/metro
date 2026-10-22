export const MYANMAR_TIME_ZONE = "Asia/Yangon";
const timestamp = new Intl.DateTimeFormat("en-GB", { timeZone: MYANMAR_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** UTC instants stay unchanged; only their display is localized. */
export function formatMyanmarTime(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? `${timestamp.format(instant)} · Myanmar time (UTC+06:30)` : "Not recorded";
}
