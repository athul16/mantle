"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(h: number, m: number) {
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Report timestamps in the viewer's time zone, by hand (no Intl) so the server
 * render (UTC) and hydration match; right after hydration they switch to local.
 * `time`: "9:40 AM". `day`: "Nov 3, 2026". `stamp`: "Nov 5, 10:14 AM".
 */
export function ReportTime({ iso, format }: { iso: string | null; format: "time" | "day" | "stamp" }) {
  const local = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  const [y, mo, day, h, mi] = local
    ? [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]
    : [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
  const text =
    format === "time" ? clock(h, mi) : format === "day" ? `${MONTHS[mo]} ${day}, ${y}` : `${MONTHS[mo]} ${day}, ${clock(h, mi)}`;
  return <time dateTime={iso}>{local ? text : `${text}${format === "day" ? "" : " UTC"}`}</time>;
}
