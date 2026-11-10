"use client";

import { useSyncExternalStore } from "react";
import { formatUtc } from "@/lib/format-date";

const noopSubscribe = () => () => {};

// Formats a timestamp in the viewer's own time zone. The server (and the
// hydration pass) render UTC, labelled, without Intl so both sides match in
// every browser; right after hydration it re-renders in the browser's zone.
export function LocalDate({ iso, withTime = false }: { iso: string | null; withTime?: boolean }) {
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!iso) return <span>—</span>;
  if (!inBrowser) return <time dateTime={iso}>{withTime ? `${formatUtc(iso)} UTC` : formatUtc(iso, false)}</time>;
  const text = new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
  return <time dateTime={iso}>{text}</time>;
}
