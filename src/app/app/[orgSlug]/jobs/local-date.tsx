"use client";

import { useSyncExternalStore } from "react";
import { formatUtc } from "@/lib/format-date";

const noopSubscribe = () => () => {};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats a timestamp in the viewer's own time zone. The server (and the
// hydration pass) render UTC, labelled, without Intl so both sides match in
// every browser; right after hydration it re-renders in the browser's zone.
// `short` shows just month and day ("Nov 21"), as the jobs table does.
export function LocalDate({ iso, withTime = false, short = false }: { iso: string | null; withTime?: boolean; short?: boolean }) {
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!iso) return <span>—</span>;
  if (short) {
    const d = new Date(iso);
    const text = inBrowser ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    return <time dateTime={iso}>{text}</time>;
  }
  if (!inBrowser) return <time dateTime={iso}>{withTime ? `${formatUtc(iso)} UTC` : formatUtc(iso, false)}</time>;
  const text = new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
  return <time dateTime={iso}>{text}</time>;
}
