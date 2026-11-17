import { DEFAULT_MEDIA_RETENTION_DAYS, DEFAULT_RESULTS_RETENTION_DAYS } from "@/lib/retention/policy";

/**
 * Proctoring constants shared by the browser, the server and tests. Nothing
 * secret lives here. See docs/02-security-and-integrity.md.
 */

/**
 * assessments.proctoring, same shape as Proctoring in src/lib/jobs/schemas.ts
 * (kept here so client code doesn't pull in zod).
 *
 * - camera: camera snapshots; screen: entire-screen share with screenshots;
 *   microphone: short audio clips when speech is heard. Any of these three
 *   makes the assessment "monitored".
 * - fullscreen: the task runs in full screen (leaving it is a signal).
 * - gaze: on-device check of facing the screen and face count, using the
 *   camera; only results are sent. Always false without the camera.
 */
export type Proctoring = { camera: boolean; screen: boolean; fullscreen: boolean; microphone: boolean; gaze: boolean };

/** Reads the jsonb column defensively: each setting only when strictly true. Old rows ({camera, screen}) still parse. */
export function readProctoring(value: unknown): Proctoring {
  const v = (value ?? {}) as Record<string, unknown>;
  const camera = v.camera === true;
  return {
    camera,
    screen: v.screen === true,
    fullscreen: v.fullscreen === true,
    microphone: v.microphone === true,
    gaze: camera && v.gaze === true,
  };
}

/**
 * Private storage bucket for proctoring media:
 * <org>/<attempt>/<camera|screen>/<file>.jpg and <org>/<attempt>/audio/<file>.<webm|ogg|m4a>
 */
export const PROCTORING_BUCKET = "proctoring";

/** One camera and one screen snapshot this often (docs/02: every 30 to 60 s), plus on events. */
export const SNAPSHOT_INTERVAL_MS = 45_000;
/**
 * Upper bound of media (snapshots and audio clips) per attempt: 4 h of
 * interval snapshots plus away captures and speech clips.
 */
export const MAX_MEDIA_PER_ATTEMPT = 2400;
/** @deprecated Use MAX_MEDIA_PER_ATTEMPT; the cap now covers audio clips too. */
export const MAX_SNAPSHOTS_PER_ATTEMPT = MAX_MEDIA_PER_ATTEMPT;
/** Longest edge of a snapshot, in pixels. Keeps one image at roughly 30–80 KB. */
export const SNAPSHOT_MAX_EDGE = 960;
export const SNAPSHOT_QUALITY = 0.7;

export type SnapshotSource = "camera" | "screen";
/** media.source values the browser can upload. */
export type MediaKind = SnapshotSource | "audio";

/** Why a capture was taken (media.reason). */
export const CAPTURE_REASONS = ["interval", "left_window", "away", "returned", "speech", "start"] as const;
export type CaptureReason = (typeof CAPTURE_REASONS)[number];

export function isCaptureReason(value: unknown): value is CaptureReason {
  return typeof value === "string" && (CAPTURE_REASONS as readonly string[]).includes(value);
}

/** While the candidate is away from the window: snapshots this long after leaving, then every AWAY_CAPTURE_INTERVAL_MS. */
export const AWAY_CAPTURE_DELAYS_MS = [2_000, 6_000] as const;
export const AWAY_CAPTURE_INTERVAL_MS = 10_000;

/** Longest audio clip recorded when speech is heard. */
export const AUDIO_CLIP_MAX_MS = 15_000;
/** Audio clip types the bucket and the upload route accept (MediaRecorder output across browsers). */
export const AUDIO_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"] as const;
export type AudioMimeType = (typeof AUDIO_MIME_TYPES)[number];
/** File extension for each audio type. */
export const AUDIO_EXTENSIONS: Record<AudioMimeType, "webm" | "ogg" | "m4a"> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
};

/** "audio/webm;codecs=opus" → "audio/webm"; null when not an allowed audio type. */
export function audioMimeType(contentType: unknown): AudioMimeType | null {
  if (typeof contentType !== "string") return null;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return (AUDIO_MIME_TYPES as readonly string[]).includes(base) ? (base as AudioMimeType) : null;
}

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
  "cut",
  "fullscreen_entered",
  "looking_away",
  "looking_back",
  "no_face",
  "face_back",
  "multiple_faces",
  "single_face",
  "speech_started",
  "speech_stopped",
  "microphone_started",
  "microphone_stopped",
  "microphone_refused",
] as const;
export type ClientSignalKind = (typeof CLIENT_SIGNAL_KINDS)[number];

/**
 * Payload contract for browser signals (v2). Every signal also carries `at`
 * (ISO time). Kinds not listed carry nothing else. Parsing and bounds live in
 * rules.ts; this type documents what the browser sends.
 *
 * - `copied`, `cut`, `pasted` → `chars`: length of the text, never the text.
 * - `returned_to_window`, `looking_back`, `face_back` → `awayMs`: how long the
 *   candidate was away / looking away / out of view.
 * - `looking_away` → `direction`: which way the candidate looked.
 * - `multiple_faces` → `faces`: how many faces the on-device check saw.
 * - `speech_stopped` → `speechMs`: how long the speech lasted.
 */
export type SignalPayloadV2 =
  | { kind: "copied" | "cut" | "pasted"; chars: number }
  | { kind: "returned_to_window" | "looking_back" | "face_back"; awayMs: number }
  | { kind: "looking_away"; direction: "left" | "right" | "up" | "down" }
  | { kind: "multiple_faces"; faces: number }
  | { kind: "speech_stopped"; speechMs: number }
  | {
      kind: Exclude<
        ClientSignalKind,
        "copied" | "cut" | "pasted" | "returned_to_window" | "looking_back" | "face_back" | "looking_away" | "multiple_faces" | "speech_stopped"
      >;
    };

/** Recorded by the server itself, never accepted from the browser. */
export const CONSENT_SIGNAL = "consented_to_monitoring";

/**
 * Recorded by the server, one per period the camera or screen share was down
 * (the task area was covered and the timer kept running, D4). Payload: source,
 * from, to, downMs, closedBy, stopEventId. See downPeriods() in rules.ts.
 */
export const DOWNTIME_SIGNAL = "monitoring_down";

/** Values of MediaTrackSettings.displaySurface, plus "unknown" for browsers that don't say. */
export const DISPLAY_SURFACES = ["monitor", "window", "browser", "application", "unknown"] as const;
export type DisplaySurface = (typeof DISPLAY_SURFACES)[number];

/** Version of the monitoring notice, stored with each consent. Change it when the text changes. */
export const MONITORING_CONSENT_VERSION = "2026-11-16.plain-notice";

/**
 * What the notice needs: what is captured (after any waiver for this
 * candidate), the org's two retention periods (organizations.settings) and
 * whom to ask about accommodations (organizations.settings.contact_email).
 */
export type MonitoringSettings = Proctoring & {
  /** The candidate is excused from full screen, so the test never enters it (D9). */
  fullscreenWaived?: boolean;
  mediaRetentionDays?: number;
  resultsRetentionDays?: number;
  contactEmail?: string | null;
};

/**
 * The monitoring notice in parts (docs/02 Compliance): what is recorded, then
 * full screen, who sees it, human review and how long it is kept. The verify
 * page shows `recorded` as a list; the system check shows monitoringNotice()
 * only if consent wasn't recorded at verify. Both come from here so they agree.
 */
export function monitoringNoticeParts(settings: MonitoringSettings, companyName: string): { recorded: string[]; details: string[] } {
  const mediaDays = settings.mediaRetentionDays ?? DEFAULT_MEDIA_RETENTION_DAYS;
  const resultsDays = settings.resultsRetentionDays ?? DEFAULT_RESULTS_RETENTION_DAYS;
  const recorded: string[] = [];
  if (settings.camera) recorded.push("a camera photo every 30 to 60 seconds, and more often when you leave the test window");
  if (settings.screen) recorded.push("a screenshot of your entire screen at the same times");
  if (settings.microphone) recorded.push("short audio clips when someone speaks, and when speech starts and stops");
  recorded.push("when you leave the test window or full screen, and when you copy, cut or paste (the length of what you paste, never the text)");
  if (settings.camera && settings.gaze) {
    recorded.push("whether you're facing the screen and how many faces your device sees (only the result is sent, never the image)");
  }
  const details: string[] = [];
  if (settings.fullscreen) details.push("The test runs in full screen. Leaving it covers the task.");
  else if (!settings.fullscreenWaived) details.push("The test opens in full screen. Leaving it is noted.");
  const media = settings.microphone ? "Photos, screenshots and audio clips" : "Photos and screenshots";
  details.push(
    `Only ${companyName}'s hiring team sees this. A person reviews anything unusual. No one is rejected automatically.`,
    settings.camera || settings.screen || settings.microphone
      ? `${media} are deleted after ${mediaDays} days, answers and results after ${resultsDays} days. We don't use photos to identify you.`
      : `Answers and results are deleted after ${resultsDays} days.`,
  );
  return { recorded, details };
}

/** The monitoring notice as paragraphs (system check). */
export function monitoringNotice(settings: MonitoringSettings, companyName: string): string[] {
  const { recorded, details } = monitoringNoticeParts(settings, companyName);
  return [`We record ${joinList(recorded)}.`, ...details, accommodationLine(companyName, settings.contactEmail)];
}

/** Whom to ask for extra time or to take the test without a camera, microphone, full screen or screen share (D9). */
export function accommodationLine(companyName: string, contactEmail?: string | null): string {
  const who = contactEmail ? `${companyName} at ${contactEmail}` : `${companyName}'s hiring team`;
  return `Need extra time, or can't use a camera, microphone, full screen or screen share? Contact ${who} before you start.`;
}

/** "a, b and c". */
export function listText(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`;
}

/** Camera, screen or microphone; full screen or gaze alone doesn't make an assessment monitored. */
export const isMonitored = (s: Proctoring) => s.camera || s.screen || s.microphone;
