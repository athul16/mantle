"use client";

import { useSyncExternalStore } from "react";
import { formatUtc } from "@/lib/format-date";

const subscribe = () => () => {};

/** A date in the candidate's own time zone. The server renders UTC until the browser takes over. */
export function LocalTime({ iso }: { iso: string }) {
  const local = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    // Not Intl: this text is rendered again in the browser during hydration and must match exactly.
    () => `${formatUtc(iso)} UTC`,
  );
  return <time dateTime={iso}>{local}</time>;
}
