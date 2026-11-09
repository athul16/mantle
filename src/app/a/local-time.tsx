"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** A date in the candidate's own time zone. The server renders UTC until the browser takes over. */
export function LocalTime({ iso }: { iso: string }) {
  const local = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    () => `${new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`,
  );
  return <time dateTime={iso}>{local}</time>;
}
