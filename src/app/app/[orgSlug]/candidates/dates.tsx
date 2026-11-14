"use client";

import { useSyncExternalStore } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const noopSubscribe = () => () => {};
const useInBrowser = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/**
 * "Nov 5" in the viewer's time zone. The server and the hydration pass render
 * the UTC date (no Intl, see src/lib/format-date.ts), then it switches to local.
 */
export function ShortDate({ iso }: { iso: string }) {
  const inBrowser = useInBrowser();
  const d = new Date(iso);
  const text = inBrowser ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return <time dateTime={iso}>{text}</time>;
}

// The current minute as an external store, so "x min ago" stays pure and updates every minute.
const subscribeMinute = (onChange: () => void) => {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
};
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** "16 min ago" once in the browser (relative times can't match between server and client); the date before that. */
export function Ago({ iso }: { iso: string }) {
  const now = useSyncExternalStore(subscribeMinute, currentMinute, () => null);
  if (now === null) return <ShortDate iso={iso} />;
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  const text = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 24 * 60 ? `${Math.round(mins / 60)} h ago` : null;
  return text ? <time dateTime={iso}>{text}</time> : <ShortDate iso={iso} />;
}
