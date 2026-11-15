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
  /** Leaving full screen once is often an accidental Esc; flag from this many. */
  fullscreenExits: 2,
  /**
   * Camera or screen share down (task area covered, timer still running, D4).
   * Flag one gap at least this long... Same bar as one long absence: a blip
   * from a flaky webcam or a browser prompt stays out of the way.
   */
  longDowntimeSeconds: 30,
  /** ...or this much covered time in total (overlapping camera and screen gaps count once). */
  totalDowntimeSeconds: 60,
  /** Snapshots within this many seconds of an event are its evidence. */
  mediaWindowSeconds: 90,
  maxEvidenceEvents: 20,
  maxEvidenceMedia: 6,
  /** From this many flags the attempt is labelled suspicious rather than review. */
  suspiciousFlags: 3,
} as const;

export type RuleId = "left_window" | "paste" | "fullscreen" | "screen_share" | "camera" | "multiple_displays" | "downtime";

export type SignalPayload = { awayMs?: number; chars?: number; surface?: DisplaySurface };

export interface SignalEvent {
  id: number;
  at: string;
  kind: ClientSignalKind | typeof CONSENT_SIGNAL | string;
  payload: SignalPayload | Record<string, unknown>;
}

export interface MediaRef {
  id: number;
  at: string;
  source: "camera" | "screen" | "phone";
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
  endAt?: string;
  closedBy?: DownClosedBy;
}

export type DownSource = "camera" | "screen";
/** A gap ends when the source is back, or at the attempt's end if it never came back (tab closed, say). */
export type DownClosedBy = "reconnected" | "submitted" | "deadline";

export interface DownPeriod {
  source: DownSource;
  /** The camera_stopped / screen_share_stopped event that opened the gap; one period per stop. */
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
  return { ...out, ...extra };
}

/** Nearest camera and nearest screen snapshot to each event, within the window. */
function nearbyMedia(events: EvidenceEvent[], media: MediaRef[]): number[] {
  const ids: number[] = [];
  const windowMs = THRESHOLDS.mediaWindowSeconds * 1000;
  for (const e of events) {
    const t = ms(e.at);
    for (const source of ["camera", "screen"] as const) {
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

function flag(rule: RuleId, reason: string, matched: EvidenceEvent[], media: MediaRef[]): FlagDraft {
  const events = matched.slice(0, THRESHOLDS.maxEvidenceEvents);
  return { rule, reason, evidence: { events, mediaIds: nearbyMedia(events, media), total: matched.length } };
}

const STOP: Record<string, DownSource> = { camera_stopped: "camera", screen_share_stopped: "screen" };
const START: Record<string, DownSource> = { camera_started: "camera", screen_share_started: "screen" };

/**
 * Periods the camera or screen share was down: from each stop to the next
 * start of the same source. A page refresh or a closed tab during a gap just
 * means the next start comes later (or never); a gap still open when the
 * attempt ends is closed at `end` (submit or deadline). Without `end`, open
 * gaps are left out until they close.
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
  if (end) for (const source of ["camera", "screen"] as const) if (open[source]) close(source, end.at, end.closedBy);
  return out.sort((a, b) => ms(a.from) - ms(b.from));
}

/** Wall-clock time covered by any gap (a camera and a screen gap at once count once). */
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
    const source = p.source === "camera" || p.source === "screen" ? p.source : undefined;
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

/** Flags for one attempt. Re-running it on more events gives the same rules with updated evidence. */
export function evaluateRules(events: SignalEvent[], media: MediaRef[], settings: Proctoring): FlagDraft[] {
  const sorted = [...events].sort((a, b) => ms(a.at) - ms(b.at) || a.id - b.id);
  const of = (kind: string) => sorted.filter((e) => e.kind === kind);
  const flags: FlagDraft[] = [];

  // Leaving the test window. Each departure carries the time away from the matching return.
  const departures: EvidenceEvent[] = [];
  let open: EvidenceEvent | null = null;
  for (const e of sorted) {
    if (e.kind === "left_window") {
      open = toEvidence(e);
      departures.push(open);
    } else if (e.kind === "returned_to_window" && open) {
      const away = num((e.payload as SignalPayload).awayMs);
      if (away !== undefined) open.awayMs = away;
      open = null;
    }
  }
  if (departures.length) {
    const totalAway = departures.reduce((sum, d) => sum + (d.awayMs ?? 0), 0) / 1000;
    const longest = Math.max(...departures.map((d) => d.awayMs ?? 0)) / 1000;
    if (
      departures.length >= THRESHOLDS.leftWindowCount ||
      longest >= THRESHOLDS.longAwaySeconds ||
      totalAway >= THRESHOLDS.totalAwaySeconds
    ) {
      const time = totalAway > 0 ? ` (${formatSeconds(totalAway)} away in total)` : "";
      flags.push(flag("left_window", `Left the test window ${plural(departures.length, "time")}${time}`, departures, media));
    }
  }

  // Pasting. Only lengths are ever stored.
  const pastes = of("pasted").map((e) => toEvidence(e));
  const pastedChars = pastes.reduce((sum, p) => sum + (p.chars ?? 0), 0);
  if (pastes.length >= THRESHOLDS.pasteCount || pastedChars >= THRESHOLDS.pasteChars) {
    flags.push(flag("paste", `Pasted text ${plural(pastes.length, "time")} (${plural(pastedChars, "character")})`, pastes, media));
  }

  const exits = of("fullscreen_exited").map((e) => toEvidence(e));
  if (exits.length >= THRESHOLDS.fullscreenExits) {
    flags.push(flag("fullscreen", `Left full screen ${plural(exits.length, "time")}`, exits, media));
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
      const reason = `Camera or screen share was down ${plural(gaps.length, "time")}: the task was covered for ${formatSeconds(covered)} in total while the timer kept running`;
      flags.push(flag("downtime", reason, gaps, media));
    }
  }

  return flags;
}

/** The attempt-level label (docs/02): clear, review or suspicious. */
export function integrityLabel(flags: Pick<FlagDraft, "rule">[]): "clear" | "review" | "suspicious" {
  if (flags.length === 0) return "clear";
  return flags.length >= THRESHOLDS.suspiciousFlags ? "suspicious" : "review";
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

/**
 * A batch from the browser: { signals: [{ kind, at, awayMs?, chars?, surface? }] }.
 * Unknown kinds and fields are dropped, so nothing else (pasted text, say) can
 * be stored. Timestamps outside the last 15 minutes become the server's now.
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
    if (kind === "returned_to_window" && bounded(r.awayMs) !== undefined) payload.awayMs = bounded(r.awayMs);
    if ((kind === "pasted" || kind === "copied") && bounded(r.chars) !== undefined) payload.chars = bounded(r.chars);
    if (kind === "screen_share_started" || kind === "screen_share_wrong_surface") {
      payload.surface = (DISPLAY_SURFACES as readonly unknown[]).includes(r.surface) ? (r.surface as DisplaySurface) : "unknown";
    }
    out.push({ kind, at, payload });
  }
  return out;
}
