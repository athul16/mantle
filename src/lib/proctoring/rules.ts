/**
 * Proctoring rules: integrity events and snapshots in, flags with evidence
 * out. Pure functions, no I/O, safe anywhere. Flags are suspicious labels for
 * a person to review (docs/02); nothing here rejects anyone.
 */
import {
  CLIENT_SIGNAL_KINDS,
  CONSENT_SIGNAL,
  DISPLAY_SURFACES,
  DOWNTIME_SIGNAL,
  type CaptureReason,
  type ClientSignalKind,
  type DisplaySurface,
  type Proctoring,
} from "./config";

/** Tuning for the rules. Open decision: confirm these with the first pilot companies. */
export const THRESHOLDS = {
  /** Flag after this many separate times away from the test window... */
  leftWindowCount: 3,
  /** ...or one absence at least this long... */
  longAwaySeconds: 30,
  /** ...or this much time away in total. */
  totalAwaySeconds: 60,
  /** Flag this many pastes, or this many pasted characters in total. */
  pasteCount: 5,
  pasteChars: 200,
  /** Flag this many copies or cuts, or this many copied characters in total. */
  copyCount: 3,
  copyChars: 300,
  /** A copy or cut followed by leaving the test window this soon (copying the task out). */
  copyThenLeaveSeconds: 10,
  /**
   * Leaving full screen once is often an accidental Esc; flag from this many.
   * Only when full screen is not required: when it is, each exit is a down
   * period and the downtime rule covers it.
   */
  fullscreenExits: 2,
  /**
   * Camera, screen share or required full screen down (task area covered,
   * timer still running, D4). Flag one gap at least this long... Same bar as
   * one long absence: a blip from a flaky webcam or a browser prompt stays out
   * of the way.
   */
  longDowntimeSeconds: 30,
  /** ...or this much covered time in total (overlapping gaps count once). */
  totalDowntimeSeconds: 60,
  /**
   * Gaze (on-device check, camera required): a look away counts from this
   * long; flag this many of them...
   */
  gazeAwaySeconds: 3,
  gazeAwayCount: 5,
  /** ...or one look away at least this long... */
  gazeLongSeconds: 10,
  /** ...or this much time looking away in total (short glances included). */
  gazeTotalSeconds: 45,
  /** No face in view: one stretch at least this long, or this much in total. */
  noFaceLongSeconds: 10,
  noFaceTotalSeconds: 30,
  /**
   * Speech (microphone): a stretch counts from this long; flag this many of
   * them, or this much speech in total. Reading aloud to oneself is common,
   * so short mutters stay out of the way.
   */
  speechSeconds: 3,
  speechCount: 3,
  speechTotalSeconds: 30,
  /** Snapshots within this many seconds of an event are its evidence. */
  mediaWindowSeconds: 90,
  maxEvidenceEvents: 20,
  maxEvidenceMedia: 6,
  /** Captures shown with each departure from the window (its filmstrip). */
  awayMediaPerDeparture: 8,
  /** A departure with no return shows captures from this long after it (or until the next departure). */
  openAwaySeconds: 600,
  /** A "returned" capture is uploaded just after the return; look this far past it. */
  returnedMediaSlackSeconds: 15,
  /** From this many flags the attempt is labelled suspicious rather than review. */
  suspiciousFlags: 3,
} as const;

export type RuleId =
  | "left_window"
  | "paste"
  | "fullscreen"
  | "screen_share"
  | "camera"
  | "multiple_displays"
  | "downtime"
  | "copy"
  | "copy_then_leave"
  | "gaze"
  | "no_face"
  | "multiple_faces"
  | "speech";

export const GAZE_DIRECTIONS = ["left", "right", "up", "down"] as const;
export type GazeDirection = (typeof GAZE_DIRECTIONS)[number];

/** Stored payload of a browser signal (SignalPayloadV2 in config.ts says which kind carries what). */
export type SignalPayload = {
  awayMs?: number;
  chars?: number;
  surface?: DisplaySurface;
  direction?: GazeDirection;
  faces?: number;
  speechMs?: number;
};

export interface SignalEvent {
  id: number;
  at: string;
  kind: ClientSignalKind | typeof CONSENT_SIGNAL | string;
  payload: SignalPayload | Record<string, unknown>;
}

export interface MediaRef {
  id: number;
  at: string;
  source: "camera" | "screen" | "phone" | "audio";
  /** Why it was captured (media.reason); null for older rows. */
  reason?: CaptureReason | null;
}

export interface EvidenceEvent {
  id: number;
  kind: string;
  at: string;
  awayMs?: number;
  chars?: number;
  surface?: string;
  /** Downtime gaps: which source, how long, when it ended and why. */
  source?: DownSource;
  downMs?: number;
  /** Downtime gaps, looks away, no-face and speech stretches: when it ended. */
  endAt?: string;
  closedBy?: DownClosedBy;
  /** looking_away: which way. */
  direction?: GazeDirection;
  /** multiple_faces: how many faces were seen. */
  faces?: number;
  /** speech_started: how long the speech lasted. */
  speechMs?: number;
  /** left_window: the screen and camera captures taken while away (the filmstrip), in time order. */
  mediaIds?: number[];
}

/** What was down: the camera, the screen share, or full screen when the assessment requires it. */
export type DownSource = "camera" | "screen" | "fullscreen";
/** A gap ends when the source is back, or at the attempt's end if it never came back (tab closed, say). */
export type DownClosedBy = "reconnected" | "submitted" | "deadline";

export interface DownPeriod {
  source: DownSource;
  /** The stop event (camera_stopped / screen_share_stopped / fullscreen_exited) that opened the gap; one period per stop. */
  stopEventId: number;
  from: string;
  to: string;
  downMs: number;
  closedBy: DownClosedBy;
}

export interface FlagEvidence {
  events: EvidenceEvent[];
  mediaIds: number[];
  /** How many events matched in all (events[] is capped). */
  total: number;
}

export interface FlagDraft {
  rule: RuleId;
  reason: string;
  evidence: FlagEvidence;
}

const ms = (iso: string) => Date.parse(iso);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatSeconds(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

function toEvidence(e: SignalEvent, extra: Partial<EvidenceEvent> = {}): EvidenceEvent {
  const p = e.payload as SignalPayload;
  const out: EvidenceEvent = { id: e.id, kind: e.kind, at: e.at };
  if (num(p.chars) !== undefined) out.chars = p.chars;
  if (typeof p.surface === "string") out.surface = p.surface;
  if ((GAZE_DIRECTIONS as readonly unknown[]).includes(p.direction)) out.direction = p.direction;
  if (num(p.faces) !== undefined) out.faces = p.faces;
  return { ...out, ...extra };
}

/** Nearest camera snapshot, screen snapshot and audio clip to each event, within the window. */
function nearbyMedia(events: EvidenceEvent[], media: MediaRef[]): number[] {
  const ids: number[] = [];
  const windowMs = THRESHOLDS.mediaWindowSeconds * 1000;
  for (const e of events) {
    const t = ms(e.at);
    for (const source of ["camera", "screen", "audio"] as const) {
      let best: MediaRef | undefined;
      for (const m of media) {
        if (m.source !== source) continue;
        const d = Math.abs(ms(m.at) - t);
        if (d <= windowMs && (!best || d < Math.abs(ms(best.at) - t))) best = m;
      }
      if (best && !ids.includes(best.id)) ids.push(best.id);
    }
    if (ids.length >= THRESHOLDS.maxEvidenceMedia) break;
  }
  return ids.slice(0, THRESHOLDS.maxEvidenceMedia);
}

function flag(rule: RuleId, reason: string, matched: EvidenceEvent[], media: MediaRef[], total = matched.length): FlagDraft {
  const events = matched.slice(0, THRESHOLDS.maxEvidenceEvents);
  return { rule, reason, evidence: { events, mediaIds: nearbyMedia(events, media), total } };
}

const AWAY_REASONS: readonly (CaptureReason | null | undefined)[] = ["away", "left_window", "returned"];

/**
 * Screen and camera captures taken while the candidate was away: from the
 * departure to `until`, plus a little slack for the "returned" capture (it is
 * recorded when its upload finishes, just after the return). Capped,
 * preferring away captures over interval ones, in time order.
 */
function awayMedia(from: string, until: number, media: MediaRef[]): number[] {
  const start = ms(from);
  const slack = THRESHOLDS.returnedMediaSlackSeconds * 1000;
  const byTime = (a: MediaRef, b: MediaRef) => ms(a.at) - ms(b.at) || a.id - b.id;
  const preferred = (m: MediaRef) => (AWAY_REASONS.includes(m.reason) ? 0 : 1);
  return media
    .filter((m) => {
      if (m.source !== "screen" && m.source !== "camera") return false;
      const t = ms(m.at);
      return t >= start && (t <= until || (m.reason === "returned" && t <= until + slack));
    })
    .sort((a, b) => preferred(a) - preferred(b) || byTime(a, b))
    .slice(0, THRESHOLDS.awayMediaPerDeparture)
    .sort(byTime)
    .map((m) => m.id);
}

type Span = EvidenceEvent & { lengthMs?: number };

/**
 * Stretches from a start signal to the next end signal (looking away →
 * looking back, no face → face back, speech started → stopped). Each span is
 * the start event with its length, from the end signal's payload when sent,
 * else from the timestamps. A span still open has no length yet.
 */
function spans(sorted: SignalEvent[], startKind: string, endKind: string, lengthField: "awayMs" | "speechMs"): Span[] {
  const out: Span[] = [];
  let open: Span | null = null;
  for (const e of sorted) {
    if (e.kind === startKind && !open) {
      open = toEvidence(e);
      out.push(open);
    } else if (e.kind === endKind && open) {
      const length = num((e.payload as SignalPayload)[lengthField]) ?? Math.max(0, ms(e.at) - ms(open.at));
      open[lengthField] = length;
      open.endAt = e.at;
      open.lengthMs = length;
      open = null;
    }
  }
  return out;
}

/** Seconds: how many spans reach `countFrom`, the longest and the total. */
function spanStats(list: Span[], countFrom: number) {
  const lengths = list.map((s) => (s.lengthMs ?? 0) / 1000);
  return {
    counted: lengths.filter((l) => l > 0 && l >= countFrom).length,
    longest: lengths.length ? Math.max(...lengths) : 0,
    total: lengths.reduce((a, b) => a + b, 0),
  };
}

const withoutLength = (list: Span[]): EvidenceEvent[] => list.map(({ lengthMs: _length, ...rest }) => rest);

const STOP: Record<string, DownSource> = { camera_stopped: "camera", screen_share_stopped: "screen", fullscreen_exited: "fullscreen" };
const START: Record<string, DownSource> = { camera_started: "camera", screen_share_started: "screen", fullscreen_entered: "fullscreen" };
const DOWN_SOURCES = ["camera", "screen", "fullscreen"] as const;

/**
 * Periods the camera, screen share or full screen was down: from each stop
 * (camera_stopped, screen_share_stopped, fullscreen_exited) to the next start
 * of the same source. Full screen periods only count toward the downtime rule
 * when the assessment requires full screen. A page refresh or a closed tab
 * during a gap just means the next start comes later (or never); a gap still
 * open when the attempt ends is closed at `end` (submit or deadline). Without
 * `end`, open gaps are left out until they close.
 */
export function downPeriods(events: SignalEvent[], end?: { at: string; closedBy: Exclude<DownClosedBy, "reconnected"> }): DownPeriod[] {
  const sorted = [...events].sort((a, b) => ms(a.at) - ms(b.at) || a.id - b.id);
  const open: Partial<Record<DownSource, SignalEvent>> = {};
  const out: DownPeriod[] = [];
  const close = (source: DownSource, to: string, closedBy: DownClosedBy) => {
    const stop = open[source]!;
    delete open[source];
    out.push({ source, stopEventId: stop.id, from: stop.at, to, downMs: Math.max(0, ms(to) - ms(stop.at)), closedBy });
  };
  for (const e of sorted) {
    if (end && ms(e.at) > ms(end.at)) break;
    const stopped = STOP[e.kind];
    const started = START[e.kind];
    if (stopped && !open[stopped]) open[stopped] = e;
    else if (started && open[started]) close(started, e.at, "reconnected");
  }
  if (end) for (const source of DOWN_SOURCES) if (open[source]) close(source, end.at, end.closedBy);
  return out.sort((a, b) => ms(a.from) - ms(b.from));
}

/** Wall-clock time covered by any gap (gaps at the same time count once). */
function coveredMs(periods: { from: string; to: string }[]): number {
  const spans = periods.map((p) => [ms(p.from), ms(p.to)] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = [NaN, NaN];
  for (const [a, b] of spans) {
    if (!(a <= curEnd)) {
      if (curEnd > curStart) total += curEnd - curStart;
      [curStart, curEnd] = [a, b];
    } else if (b > curEnd) curEnd = b;
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

/** Recorded down periods (DOWNTIME_SIGNAL events), one per stop event, for the sources this assessment uses. */
function recordedDowntime(events: SignalEvent[], settings: Proctoring): EvidenceEvent[] {
  const seen = new Set<number>();
  const out: EvidenceEvent[] = [];
  for (const e of events) {
    if (e.kind !== DOWNTIME_SIGNAL) continue;
    const p = e.payload as Partial<DownPeriod>;
    const source = (DOWN_SOURCES as readonly unknown[]).includes(p.source) ? (p.source as DownSource) : undefined;
    const downMs = num(p.downMs);
    if (!source || !settings[source] || downMs === undefined || typeof p.from !== "string" || typeof p.to !== "string") continue;
    if (typeof p.stopEventId === "number") {
      if (seen.has(p.stopEventId)) continue;
      seen.add(p.stopEventId);
    }
    const closedBy = p.closedBy === "submitted" || p.closedBy === "deadline" ? p.closedBy : "reconnected";
    out.push({ id: e.id, kind: DOWNTIME_SIGNAL, at: p.from, source, downMs, endAt: p.to, closedBy });
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}

function downtimeReason(gaps: EvidenceEvent[], coveredSeconds: number): string {
  const covered = `the task was covered for ${formatSeconds(coveredSeconds)} in total while the timer kept running`;
  const hasFullscreen = gaps.some((g) => g.source === "fullscreen");
  if (!hasFullscreen) return `Camera or screen share was down ${plural(gaps.length, "time")}: ${covered}`;
  if (gaps.every((g) => g.source === "fullscreen")) return `Left full screen ${plural(gaps.length, "time")}: ${covered}`;
  return `Camera, screen share or full screen was down ${plural(gaps.length, "time")}: ${covered}`;
}

/** Flags for one attempt. Re-running it on more events gives the same rules with updated evidence. */
export function evaluateRules(events: SignalEvent[], media: MediaRef[], settings: Proctoring): FlagDraft[] {
  const sorted = [...events].sort((a, b) => ms(a.at) - ms(b.at) || a.id - b.id);
  const of = (kind: string) => sorted.filter((e) => e.kind === kind);
  const flags: FlagDraft[] = [];

  // Leaving the test window. Each departure carries the time away from the
  // matching return and the captures taken while away (its filmstrip).
  const departures: EvidenceEvent[] = [];
  const returnedAt = new Map<EvidenceEvent, number>();
  let open: EvidenceEvent | null = null;
  for (const e of sorted) {
    if (e.kind === "left_window") {
      open = toEvidence(e);
      departures.push(open);
    } else if (e.kind === "returned_to_window" && open) {
      const away = num((e.payload as SignalPayload).awayMs);
      if (away !== undefined) open.awayMs = away;
      returnedAt.set(open, ms(e.at));
      open = null;
    }
  }
  departures.forEach((d, i) => {
    const next = departures[i + 1] ? ms(departures[i + 1].at) : Infinity;
    const until = returnedAt.get(d) ?? (d.awayMs !== undefined ? ms(d.at) + d.awayMs : Math.min(ms(d.at) + THRESHOLDS.openAwaySeconds * 1000, next));
    const ids = awayMedia(d.at, until, media);
    if (ids.length) d.mediaIds = ids;
  });
  if (departures.length) {
    const totalAway = departures.reduce((sum, d) => sum + (d.awayMs ?? 0), 0) / 1000;
    const longest = Math.max(...departures.map((d) => d.awayMs ?? 0)) / 1000;
    if (
      departures.length >= THRESHOLDS.leftWindowCount ||
      longest >= THRESHOLDS.longAwaySeconds ||
      totalAway >= THRESHOLDS.totalAwaySeconds
    ) {
      const time = totalAway > 0 ? ` (${formatSeconds(totalAway)} away in total)` : "";
      const f = flag("left_window", `Left the test window ${plural(departures.length, "time")}${time}`, departures, media);
      // The first away screenshot of each departure leads the flag's own snapshots
      // (still capped; each departure's mediaIds holds its full filmstrip).
      const firstAway = f.evidence.events.flatMap((d) => {
        const ids = d.mediaIds ?? [];
        const screen = ids.find((id) => media.find((m) => m.id === id)?.source === "screen");
        return screen ?? ids[0] ?? [];
      });
      f.evidence.mediaIds = [...new Set([...firstAway, ...f.evidence.mediaIds])].slice(0, THRESHOLDS.maxEvidenceMedia);
      flags.push(f);
    }
  }

  // Pasting. Only lengths are ever stored.
  const pastes = of("pasted").map((e) => toEvidence(e));
  const pastedChars = pastes.reduce((sum, p) => sum + (p.chars ?? 0), 0);
  if (pastes.length >= THRESHOLDS.pasteCount || pastedChars >= THRESHOLDS.pasteChars) {
    flags.push(flag("paste", `Pasted text ${plural(pastes.length, "time")} (${plural(pastedChars, "character")})`, pastes, media));
  }

  // Copying or cutting. Only lengths are ever stored.
  const copies = sorted.filter((e) => e.kind === "copied" || e.kind === "cut").map((e) => toEvidence(e));
  const copiedChars = copies.reduce((sum, c) => sum + (c.chars ?? 0), 0);
  if (copies.length >= THRESHOLDS.copyCount || copiedChars >= THRESHOLDS.copyChars) {
    flags.push(flag("copy", `Copied text ${plural(copies.length, "time")} (${plural(copiedChars, "character")})`, copies, media));
  }

  // A copy followed soon after by leaving the window: each departure pairs with the latest copy before it.
  const pairs: EvidenceEvent[] = [];
  let lastCopy: SignalEvent | null = null;
  for (const e of sorted) {
    if (e.kind === "copied" || e.kind === "cut") lastCopy = e;
    else if (e.kind === "left_window" && lastCopy) {
      if (ms(e.at) - ms(lastCopy.at) <= THRESHOLDS.copyThenLeaveSeconds * 1000) pairs.push(toEvidence(lastCopy), toEvidence(e));
      lastCopy = null;
    }
  }
  if (pairs.length) {
    const n = pairs.length / 2;
    const reason = `Copied text, then left the test window within ${formatSeconds(THRESHOLDS.copyThenLeaveSeconds)} (${plural(n, "time")})`;
    flags.push(flag("copy_then_leave", reason, pairs, media, n));
  }

  // When full screen is required each exit is a down period (downtime below); otherwise count exits.
  if (!settings.fullscreen) {
    const exits = of("fullscreen_exited").map((e) => toEvidence(e));
    if (exits.length >= THRESHOLDS.fullscreenExits) {
      flags.push(flag("fullscreen", `Left full screen ${plural(exits.length, "time")}`, exits, media));
    }
  }

  if (settings.screen) {
    const stopped = of("screen_share_stopped").map((e) => toEvidence(e));
    const wrong = of("screen_share_wrong_surface").map((e) => toEvidence(e));
    if (stopped.length) {
      flags.push(flag("screen_share", `Screen sharing stopped ${plural(stopped.length, "time")}`, [...stopped, ...wrong], media));
    } else if (wrong.length) {
      flags.push(flag("screen_share", "Tried to share a window or tab instead of the entire screen", wrong, media));
    }
    const displays = of("multiple_displays").map((e) => toEvidence(e));
    if (displays.length) flags.push(flag("multiple_displays", "A second display was connected", displays, media));
  }

  if (settings.camera) {
    const off = of("camera_stopped").map((e) => toEvidence(e));
    if (off.length) flags.push(flag("camera", `Camera turned off ${plural(off.length, "time")}`, off, media));
  }

  // Downtime (D4): the timer never pauses, so show how long the task was covered for the recruiter to judge.
  const gaps = recordedDowntime(sorted, settings);
  if (gaps.length) {
    const covered = coveredMs(gaps.map((g) => ({ from: g.at, to: g.endAt! }))) / 1000;
    const longest = Math.max(...gaps.map((g) => g.downMs ?? 0)) / 1000;
    if (longest >= THRESHOLDS.longDowntimeSeconds || covered >= THRESHOLDS.totalDowntimeSeconds) {
      flags.push(flag("downtime", downtimeReason(gaps, covered), gaps, media));
    }
  }

  // On-device gaze and face count (camera required; readProctoring enforces it).
  if (settings.gaze) {
    const looks = spans(sorted, "looking_away", "looking_back", "awayMs");
    const g = spanStats(looks, THRESHOLDS.gazeAwaySeconds);
    if (g.counted >= THRESHOLDS.gazeAwayCount || g.longest >= THRESHOLDS.gazeLongSeconds || g.total >= THRESHOLDS.gazeTotalSeconds) {
      const reason = `Looked away from the screen ${plural(looks.length, "time")} (${formatSeconds(g.total)} in total, longest ${formatSeconds(g.longest)})`;
      flags.push(flag("gaze", reason, withoutLength(looks), media));
    }

    const gone = spans(sorted, "no_face", "face_back", "awayMs");
    const n = spanStats(gone, 0);
    if (n.longest >= THRESHOLDS.noFaceLongSeconds || n.total >= THRESHOLDS.noFaceTotalSeconds) {
      const reason = `No face in view ${plural(gone.length, "time")} (${formatSeconds(n.total)} in total, longest ${formatSeconds(n.longest)})`;
      flags.push(flag("no_face", reason, withoutLength(gone), media));
    }

    const crowd = of("multiple_faces").map((e) => toEvidence(e));
    if (crowd.length) flags.push(flag("multiple_faces", `More than one face in view ${plural(crowd.length, "time")}`, crowd, media));
  }

  if (settings.microphone) {
    const speech = spans(sorted, "speech_started", "speech_stopped", "speechMs");
    const s = spanStats(speech, THRESHOLDS.speechSeconds);
    if (s.counted >= THRESHOLDS.speechCount || s.total >= THRESHOLDS.speechTotalSeconds) {
      flags.push(flag("speech", `Speech heard ${plural(speech.length, "time")} (${formatSeconds(s.total)} in total)`, withoutLength(speech), media));
    }
  }

  return flags;
}

/**
 * How serious each rule is on its own. "high": worth a look before anything
 * else; "medium": often innocent. Shown with the flag; the label below uses
 * the combinations that matter.
 */
export const RULE_SEVERITY: Record<RuleId, "high" | "medium"> = {
  copy_then_leave: "high",
  multiple_faces: "high",
  multiple_displays: "high",
  left_window: "high",
  screen_share: "high",
  downtime: "high",
  speech: "high",
  no_face: "medium",
  gaze: "medium",
  camera: "medium",
  copy: "medium",
  paste: "medium",
  fullscreen: "medium",
};

/** Short plain-English names of the rules, for "Flagged for review: ..." lines. */
export const RULE_TITLES: Record<RuleId, string> = {
  left_window: "left the test window",
  paste: "pasted text",
  copy: "copied text",
  copy_then_leave: "copied text, then left the test window",
  fullscreen: "left full screen",
  screen_share: "screen sharing problems",
  camera: "camera turned off",
  multiple_displays: "a second display",
  downtime: "monitoring was down",
  gaze: "looked away from the screen",
  no_face: "no face in view",
  multiple_faces: "more than one face in view",
  speech: "speech heard",
};

type RuleLike = { rule: RuleId | string | null };

const LEFT_WITH: [string, string][] = [
  ["camera", "Left the test window, and the camera was turned off"],
  ["screen_share", "Left the test window, and screen sharing stopped"],
  ["downtime", "Left the test window, and monitoring was down"],
  ["no_face", "Left the test window, and no face was in view at times"],
];

/** Why the attempt is suspicious (empty when it isn't). */
function suspiciousReasons(rules: Set<string>, count: number): string[] {
  const out: string[] = [];
  if (rules.has("copy_then_leave")) out.push("Copied text, then left the test window");
  if (rules.has("multiple_faces")) out.push("More than one face was in view");
  if (rules.has("left_window")) for (const [other, line] of LEFT_WITH) if (rules.has(other)) out.push(line);
  if (rules.has("speech") && rules.has("gaze")) out.push("Speech was heard, and the candidate looked away from the screen");
  if (rules.has("speech") && rules.has("left_window")) out.push("Speech was heard, and the candidate left the test window");
  if (!out.length && count >= THRESHOLDS.suspiciousFlags) out.push(`${count} different kinds of unusual moments`);
  return out;
}

/**
 * The plain-English reason(s) behind integrityLabel(flags), for the report:
 * the combinations that made it suspicious, or what is up for review. Empty
 * when the attempt is clear.
 */
export function labelReasons(flags: RuleLike[]): string[] {
  if (!flags.length) return [];
  const rules = new Set(flags.map((f) => f.rule ?? ""));
  const suspicious = suspiciousReasons(rules, flags.length);
  if (suspicious.length) return suspicious;
  const titles = [...rules].map((r) => RULE_TITLES[r as RuleId] ?? r).filter(Boolean);
  return [`Flagged for review: ${titles.join(", ")}`];
}

/**
 * The attempt-level label (docs/02): clear, review or suspicious. Suspicious
 * for the combinations in labelReasons() or from THRESHOLDS.suspiciousFlags
 * flags; review for any other flag. A label only: nothing rejects anyone.
 */
export function integrityLabel(flags: RuleLike[]): "clear" | "review" | "suspicious" {
  if (flags.length === 0) return "clear";
  return suspiciousReasons(new Set(flags.map((f) => f.rule ?? "")), flags.length).length ? "suspicious" : "review";
}

export interface ParsedSignal {
  kind: ClientSignalKind;
  at: string;
  payload: SignalPayload;
}

const MAX_BATCH = 50;
/** How far back a browser timestamp may be (a batch held while offline). */
const MAX_AGE_MS = 15 * 60_000;
const MAX_NUMBER = 24 * 3_600_000;
const MIN_FACES = 2;
const MAX_FACES = 10;

const CHARS_KINDS: readonly string[] = ["copied", "cut", "pasted"];
const AWAY_KINDS: readonly string[] = ["returned_to_window", "looking_back", "face_back"];

/**
 * A batch from the browser: { signals: [{ kind, at, ...payload }] } with the
 * payload fields of SignalPayloadV2 (config.ts): chars, awayMs, direction,
 * faces, speechMs, surface, each only on the kinds that carry it. Unknown
 * kinds and fields are dropped, so nothing else (pasted text, say) can be
 * stored. Timestamps outside the last 15 minutes become the server's now.
 */
export function parseSignalBatch(body: unknown, now = new Date()): ParsedSignal[] {
  const list = (body as { signals?: unknown } | null)?.signals;
  if (!Array.isArray(list)) return [];
  const out: ParsedSignal[] = [];
  for (const raw of list.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!(CLIENT_SIGNAL_KINDS as readonly unknown[]).includes(r.kind)) continue;
    const kind = r.kind as ClientSignalKind;

    const t = typeof r.at === "string" ? Date.parse(r.at) : NaN;
    const at = Number.isFinite(t) && t <= now.getTime() && t >= now.getTime() - MAX_AGE_MS ? new Date(t).toISOString() : now.toISOString();

    const payload: SignalPayload = {};
    const bounded = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), MAX_NUMBER) : undefined);
    if (AWAY_KINDS.includes(kind) && bounded(r.awayMs) !== undefined) payload.awayMs = bounded(r.awayMs);
    if (CHARS_KINDS.includes(kind) && bounded(r.chars) !== undefined) payload.chars = bounded(r.chars);
    if (kind === "speech_stopped" && bounded(r.speechMs) !== undefined) payload.speechMs = bounded(r.speechMs);
    if (kind === "looking_away" && (GAZE_DIRECTIONS as readonly unknown[]).includes(r.direction)) payload.direction = r.direction as GazeDirection;
    if (kind === "multiple_faces" && bounded(r.faces) !== undefined) payload.faces = Math.min(Math.max(bounded(r.faces)!, MIN_FACES), MAX_FACES);
    if (kind === "screen_share_started" || kind === "screen_share_wrong_surface") {
      payload.surface = (DISPLAY_SURFACES as readonly unknown[]).includes(r.surface) ? (r.surface as DisplaySurface) : "unknown";
    }
    out.push({ kind, at, payload });
  }
  return out;
}
