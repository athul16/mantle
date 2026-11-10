"use client";

import type { SnapshotSource } from "../config";

/**
 * Camera and screen streams opened on the system check, kept for the
 * workspace. Pages from check → instructions → workspace are client-side
 * navigations, so the candidate isn't asked to share again. A reload loses
 * them (browsers don't keep capture across page loads) and the workspace asks
 * again.
 */
const held: Partial<Record<SnapshotSource, MediaStream>> = {};

const isLive = (s: MediaStream | undefined) => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

export function holdMedia(source: SnapshotSource, stream: MediaStream) {
  if (held[source] && held[source] !== stream) stopStream(held[source]);
  held[source] = stream;
}

/** The held stream for a source, if it is still live. */
export function heldMedia(source: SnapshotSource): MediaStream | undefined {
  const s = held[source];
  if (isLive(s)) return s;
  delete held[source];
  return undefined;
}

export function dropMedia(source: SnapshotSource) {
  delete held[source];
}

/** Stops and forgets everything (end of the test). */
export function releaseMedia() {
  for (const source of Object.keys(held) as SnapshotSource[]) {
    stopStream(held[source]);
    delete held[source];
  }
}

export function stopStream(stream: MediaStream | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}
