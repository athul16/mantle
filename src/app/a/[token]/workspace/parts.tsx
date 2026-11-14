"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { formatRemaining } from "./labels";

/** Under this many ms the timer turns amber (prototype: 5 minutes). */
export const LOW_TIME_MS = 5 * 60_000;

/**
 * The dark countdown pill (.timer). Display only: the server enforces the
 * deadline. `low` turns it amber.
 */
export function TimerBadge({ remainingMs }: { remainingMs: number }) {
  const low = remainingMs < LOW_TIME_MS;
  const left = Math.max(0, Math.ceil(remainingMs / 1000));
  return (
    <span
      className={low ? "timer low" : "timer"}
      role="timer"
      title="Time left. The official clock is on our server."
      aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds left`}
    >
      <Icon name="clock" />
      <span className="t">{formatRemaining(remainingMs)}</span>
    </span>
  );
}

/**
 * Display-only countdown to `deadlineAt`, corrected by the server's clock.
 * At zero it asks the server for the page again (which moves a timed-out
 * attempt on to the done page).
 */
export function LiveTimer({ deadlineAt, serverNow }: { deadlineAt: string; serverNow: string }) {
  const router = useRouter();
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const deadline = new Date(deadlineAt).getTime();
  const [remaining, setRemaining] = useState(() => deadline - new Date(serverNow).getTime());
  useEffect(() => {
    let refreshed = false;
    const tick = setInterval(() => {
      const left = deadline - (Date.now() + offset);
      setRemaining(left);
      if (left <= 0 && !refreshed) {
        refreshed = true;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [deadline, offset, router]);
  return <TimerBadge remainingMs={remaining} />;
}

const subscribe = () => () => {};

/**
 * A wall-clock time ("9:40 AM") in the candidate's own time zone. Rendered
 * empty on the server and filled in by the browser, so hydration never
 * disagrees about the time zone.
 */
export function ClockTime({ iso, short = false }: { iso: string; short?: boolean }) {
  const text = useSyncExternalStore(
    subscribe,
    () => {
      const t = new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return short ? t.replace(/\s?[AP]M$/, "") : t;
    },
    () => "",
  );
  return <time dateTime={iso}>{text}</time>;
}
