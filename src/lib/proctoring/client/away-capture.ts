"use client";

import { AWAY_CAPTURE_DELAYS_MS, AWAY_CAPTURE_INTERVAL_MS, type SnapshotSource } from "../config";
import { takeSnapshot } from "./snapshots";

/**
 * While the candidate is in another window: screen and camera snapshots at 2 s
 * and 6 s after leaving, then every 10 s, so the recruiter sees what they
 * switched to. One more when they come back. Timing runs in a dedicated Worker
 * (not throttled in hidden tabs), falling back to setTimeout where there is no
 * Worker (tests).
 */

/** Captures per absence (two sources each), so a candidate who walks away doesn't fill the media cap. */
export const MAX_AWAY_CAPTURES = 60;

const SOURCES: SnapshotSource[] = ["screen", "camera"];

export type AwayCapture = { left(): void; returned(): void; stop(): void };

type Timers = { set(ms: number, fn: () => void): number; clear(id: number): void; close(): void };

function workerTimers(): Timers | null {
  if (typeof Worker === "undefined") return null;
  try {
    const worker = new Worker(new URL("./capture-timer.worker.ts", import.meta.url));
    const pending = new Map<number, () => void>();
    let next = 0;
    worker.onmessage = (e: MessageEvent<{ id: number }>) => {
      const fn = pending.get(e.data.id);
      pending.delete(e.data.id);
      fn?.();
    };
    return {
      set(ms, fn) {
        const id = ++next;
        pending.set(id, fn);
        worker.postMessage({ type: "set", id, ms });
        return id;
      },
      clear(id) {
        pending.delete(id);
        worker.postMessage({ type: "clear", id });
      },
      close() {
        pending.clear();
        worker.terminate();
      },
    };
  } catch {
    return null;
  }
}

function plainTimers(): Timers {
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 0;
  return {
    set(ms, fn) {
      const id = ++next;
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id);
          fn();
        }, ms),
      );
      return id;
    },
    clear(id) {
      clearTimeout(handles.get(id));
      handles.delete(id);
    },
    close() {
      handles.forEach((h) => clearTimeout(h));
      handles.clear();
    },
  };
}

export function createAwayCapture(opts: {
  getStream: (source: SnapshotSource) => MediaStream | undefined;
  capture?: typeof takeSnapshot;
}): AwayCapture {
  const capture = opts.capture ?? takeSnapshot;
  let timers: Timers | null = null;
  let away = false;
  let count = 0;
  let timer: number | null = null;

  const live = (s: MediaStream | undefined): s is MediaStream => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

  const captureAll = (reason: "away" | "returned") => {
    for (const source of SOURCES) {
      const stream = opts.getStream(source);
      if (!live(stream)) continue;
      Promise.resolve(capture(source, stream, reason)).catch(() => {});
    }
  };

  const clearTimer = () => {
    if (timer !== null) timers?.clear(timer);
    timer = null;
  };

  // count = captures taken so far; the next is due at the count-th delay, then every interval after the last delay.
  const scheduleNext = () => {
    if (!away || count >= MAX_AWAY_CAPTURES) return;
    const delays = AWAY_CAPTURE_DELAYS_MS;
    const ms = count < delays.length ? delays[count] - (count > 0 ? delays[count - 1] : 0) : AWAY_CAPTURE_INTERVAL_MS;
    timers ??= workerTimers() ?? plainTimers();
    timer = timers.set(ms, () => {
      timer = null;
      if (!away) return;
      count++;
      captureAll("away");
      scheduleNext();
    });
  };

  const end = () => {
    away = false;
    clearTimer();
  };

  return {
    left() {
      if (away) return;
      away = true;
      count = 0;
      scheduleNext();
    },
    returned() {
      if (!away) return;
      end();
      captureAll("returned");
    },
    stop() {
      end();
      timers?.close();
      timers = null;
    },
  };
}
