const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A UTC date (and optionally time) built by hand, e.g. "Nov 30, 2026, 11:59 PM".
 * Used for text rendered on the server and again during hydration: it must not
 * depend on the runtime's Intl data, because Node and WebKit format the same
 * options differently ("Nov 30, 2026 at 11:59 PM") and React then throws #418.
 */
export function formatUtc(iso: string, withTime = true): string {
  const d = new Date(iso);
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  if (!withTime) return date;
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date}, ${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}
