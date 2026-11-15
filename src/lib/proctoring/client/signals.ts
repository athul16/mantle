"use client";

import type { ClientSignalKind } from "../config";

/**
 * A browser signal as sent to /api/candidate/proctoring/signals. Optional
 * fields follow SignalPayloadV2 in config.ts.
 */
export type Signal = {
  kind: ClientSignalKind;
  at: string;
  awayMs?: number;
  chars?: number;
  surface?: string;
  direction?: "left" | "right" | "up" | "down";
  faces?: number;
  speechMs?: number;
};

export const SIGNALS_URL = "/api/candidate/proctoring/signals";

export function makeSignal(kind: ClientSignalKind, payload: Omit<Signal, "kind" | "at"> = {}): Signal {
  return { kind, at: new Date().toISOString(), ...payload };
}

/** Sends a batch. Throws when it didn't reach the server, so callers can keep the batch. */
export async function sendSignals(signals: Signal[], { keepalive = false } = {}): Promise<void> {
  if (!signals.length) return;
  const res = await fetch(SIGNALS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signals }),
    keepalive,
  });
  if (res.status >= 500) throw new Error(`signals: HTTP ${res.status}`);
}
