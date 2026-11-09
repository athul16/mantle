"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

// Formats a timestamp in the viewer's own time zone. The server (and the
// hydration pass) render UTC, labelled; right after hydration it re-renders
// in the browser's zone.
export function LocalDate({ iso, withTime = false }: { iso: string | null; withTime?: boolean }) {
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!iso) return <span>—</span>;
  const text = new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    ...(inBrowser ? {} : { timeZone: "UTC" }),
  });
  return <time dateTime={iso}>{inBrowser || !withTime ? text : `${text} UTC`}</time>;
}
