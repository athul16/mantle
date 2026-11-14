"use client";

import { useSyncExternalStore } from "react";
import { formatUtc } from "@/lib/format-date";

const subscribe = () => () => {};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "medium": "Nov 21, 2026, 11:59 PM" (the original format)
 * "day": "Fri, Nov 21"
 * "dayTime": "Fri, Nov 21, 11:59 PM"
 */
export type LocalTimeFormat = "medium" | "day" | "dayTime";

/** Built by hand from the given getters so the server (UTC) and browser (local) strings use the same shape. */
function build(d: Date, utc: boolean, format: Exclude<LocalTimeFormat, "medium">): string {
  const day = utc ? d.getUTCDay() : d.getDay();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const date = utc ? d.getUTCDate() : d.getDate();
  const text = `${DAYS[day]}, ${MONTHS[month]} ${date}`;
  if (format === "day") return text;
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = String(utc ? d.getUTCMinutes() : d.getMinutes()).padStart(2, "0");
  return `${text}, ${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** A date in the candidate's own time zone. The server renders UTC until the browser takes over. */
export function LocalTime({ iso, format = "medium" }: { iso: string; format?: LocalTimeFormat }) {
  const local = useSyncExternalStore(
    subscribe,
    () =>
      format === "medium"
        ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : build(new Date(iso), false, format),
    // Not Intl: this text is rendered again in the browser during hydration and must match exactly.
    () => (format === "medium" ? `${formatUtc(iso)} UTC` : `${build(new Date(iso), true, format)}${format === "dayTime" ? " UTC" : ""}`),
  );
  return <time dateTime={iso}>{local}</time>;
}
