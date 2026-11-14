import { DEFAULT_RETENTION_DAYS } from "@/lib/retention/policy";

/**
 * Proctoring constants shared by the browser, the server and tests. Nothing
 * secret lives here. See docs/02-security-and-integrity.md.
 */

/** assessments.proctoring, same shape as Proctoring in src/lib/jobs/schemas.ts (kept here so client code doesn't pull in zod). */
export type Proctoring = { camera: boolean; screen: boolean };

export function readProctoring(value: unknown): Proctoring {
  const v = (value ?? {}) as Record<string, unknown>;
  return { camera: v.camera === true, screen: v.screen === true };
}

/** Private storage bucket for camera and screen snapshots: <org>/<attempt>/<source>/<file>.jpg */
export const PROCTORING_BUCKET = "proctoring";

/** One camera and one screen snapshot this often (docs/02: every 30 to 60 s), plus on events. */
export const SNAPSHOT_INTERVAL_MS = 45_000;
/** Upper bound per attempt (4 h × 2 sources × one per 30 s, with room for event snapshots). */
export const MAX_SNAPSHOTS_PER_ATTEMPT = 1200;
/** Longest edge of a snapshot, in pixels. Keeps one image at roughly 30–80 KB. */
export const SNAPSHOT_MAX_EDGE = 960;
export const SNAPSHOT_QUALITY = 0.7;

export type SnapshotSource = "camera" | "screen";

/** What the browser may report. */
export const CLIENT_SIGNAL_KINDS = [
  "left_window",
  "returned_to_window",
  "fullscreen_exited",
  "copied",
  "pasted",
  "camera_started",
  "camera_stopped",
  "camera_refused",
  "screen_share_started",
  "screen_share_stopped",
  "screen_share_refused",
  "screen_share_wrong_surface",
  "multiple_displays",
] as const;
export type ClientSignalKind = (typeof CLIENT_SIGNAL_KINDS)[number];

/** Recorded by the server itself, never accepted from the browser. */
export const CONSENT_SIGNAL = "consented_to_monitoring";

/** Values of MediaTrackSettings.displaySurface, plus "unknown" for browsers that don't say. */
export const DISPLAY_SURFACES = ["monitor", "window", "browser", "application", "unknown"] as const;
export type DisplaySurface = (typeof DISPLAY_SURFACES)[number];

/** Version of the monitoring notice, stored with each consent. Change it when the text changes. */
export const MONITORING_CONSENT_VERSION = "2026-11-11.verify-table";

/** What the notice needs: what is captured, plus the org's retention (organizations.settings.retention_days). */
export type MonitoringSettings = Proctoring & { retentionDays?: number };

/**
 * The monitoring notice as paragraphs: what is captured, why, who sees it and
 * for how long (docs/02 Compliance). The verify page shows the same facts as a
 * table; the system check shows these paragraphs only if consent wasn't
 * recorded at verify (e.g. a session from before the change).
 */
export function monitoringNotice(settings: MonitoringSettings, companyName: string): string[] {
  const days = settings.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const captured: string[] = [];
  if (settings.camera) captured.push("a camera photo every 30 to 60 seconds and when you leave the test window");
  if (settings.screen) captured.push("a screenshot of your entire screen at the same times");
  captured.push("when you leave the test window, leave full screen, copy or paste (the length of what you paste, never the text)");
  return [
    `While you take this test we record ${joinList(captured)}.`,
    `Why: so ${companyName} can trust that the work is yours. Only ${companyName}'s hiring team can see the photos and screenshots.`,
    "Unusual moments are marked for a person to check, with the matching photos. No one is rejected automatically.",
    `How long: kept for ${days} days after your assessment ends, then deleted. ${companyName} can delete it sooner on request. We don't use the photos to identify you.`,
  ];
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`;
}

export const isMonitored = (s: Proctoring) => s.camera || s.screen;
