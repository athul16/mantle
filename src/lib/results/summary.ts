import { describeAccommodations, readAccommodations } from "@/lib/accommodations";
import type { AttemptScore, StepScore } from "@/lib/engine/types";
import type { InviteStatus } from "@/lib/jobs/status";

// Pure helpers for the results table and candidate report. No database, no
// answer keys: safe to import from client components.

/** A step score as stored, plus who marked it when a person reviewed it. */
export type StoredStepScore = StepScore & { review?: { by: string; at: string } };
export type StoredAttemptScore = Omit<AttemptScore, "steps"> & { steps: Record<string, StoredStepScore> };

/** Reads attempts.score defensively; anything not shaped like a score is null. */
export function readAttemptScore(raw: unknown): StoredAttemptScore | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<StoredAttemptScore>;
  if (typeof s.points !== "number" || typeof s.maxPoints !== "number" || !s.steps || typeof s.steps !== "object") return null;
  return s as StoredAttemptScore;
}

/** Steps still waiting for a person to mark them. */
export function stepsNeedingReview(score: StoredAttemptScore | null): string[] {
  if (!score) return [];
  return Object.entries(score.steps)
    .filter(([, s]) => s?.needsReview === true)
    .map(([id]) => id);
}

export function scorePercent(points: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  return Math.round((points / maxPoints) * 1000) / 10;
}

/** Seconds between start and submit, or null when either is missing. */
export function durationSeconds(startedAt: string | null, submittedAt: string | null): number | null {
  if (!startedAt || !submittedAt) return null;
  const ms = new Date(submittedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/** "45 s", "38 min", "1 h 05 min". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** "+0:00", "+2:05", "+1:02:03" from the attempt start. */
export function formatOffset(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `+${h}:${String(m).padStart(2, "0")}:${sec}` : `+${m}:${sec}`;
}

// ---------------------------------------------------------------------------
// Results table
// ---------------------------------------------------------------------------

export type ResultRow = {
  inviteId: string;
  email: string;
  candidateName: string | null;
  status: InviteStatus;
  needsReview: boolean;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  timeTakenSeconds: number | null;
  submittedAt: string | null;
  invitedAt: string;
};

export const SORT_KEYS = ["candidate", "status", "score", "time", "submitted"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const STATUS_FILTERS = ["all", "needs_review", "completed", "started", "invited", "expired", "revoked"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  needs_review: "Needs review",
  completed: "Completed",
  started: "Started",
  invited: "Invited",
  expired: "Expired",
  revoked: "Revoked",
};

// Funnel order, so "status" sorts completed candidates together.
const STATUS_ORDER: Record<InviteStatus, number> = { completed: 0, started: 1, invited: 2, expired: 3, revoked: 4 };

export function candidateLabel(row: Pick<ResultRow, "candidateName" | "email">): string {
  return row.candidateName?.trim() || row.email;
}

function sortValue(row: ResultRow, key: SortKey): string | number | null {
  switch (key) {
    case "candidate":
      return candidateLabel(row).toLowerCase();
    case "status":
      return STATUS_ORDER[row.status] * 2 + (row.needsReview ? 0 : 1);
    case "score":
      return row.percent;
    case "time":
      return row.timeTakenSeconds;
    case "submitted":
      return row.submittedAt ? new Date(row.submittedAt).getTime() : null;
  }
}

/** Stable sort; rows without a value (not submitted yet) always go last. */
export function sortRows(rows: readonly ResultRow[], key: SortKey, dir: SortDir): ResultRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: sortValue(row, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === "string" ? a.v.localeCompare(b.v as string) : a.v - (b.v as number);
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

export function filterRows(rows: readonly ResultRow[], status: StatusFilter, query = ""): ResultRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (status === "needs_review" ? !row.needsReview : status !== "all" && row.status !== status) return false;
    if (!q) return true;
    return row.email.toLowerCase().includes(q) || (row.candidateName ?? "").toLowerCase().includes(q);
  });
}

/** Default direction when a column is first clicked: best scores, newest submits first. */
export function defaultDir(key: SortKey): SortDir {
  return key === "score" || key === "submitted" ? "desc" : "asc";
}

// ---------------------------------------------------------------------------
// Attempt timeline
// ---------------------------------------------------------------------------

export type ActionEvent = { at: string; kind: string; payload: unknown };
export type TimelineEntry = { at: string; offset: string; text: string };

function field(payload: unknown, name: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const v = (payload as Record<string, unknown>)[name];
  return typeof v === "string" ? v : undefined;
}

/**
 * Turns action_events into readable lines with the time since the start.
 * Consecutive autosaves of the same step collapse into one line.
 */
export function buildTimeline(
  events: readonly ActionEvent[],
  opts: { startedAt: string | null; stepTitles: Record<string, string>; messageSubjects: Record<string, string> },
): TimelineEntry[] {
  const sorted = [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const start = opts.startedAt ? new Date(opts.startedAt).getTime() : sorted.length ? new Date(sorted[0].at).getTime() : 0;
  const step = (p: unknown) => {
    const id = field(p, "stepId");
    return id ? `"${opts.stepTitles[id] ?? id}"` : "a task";
  };

  const out: (TimelineEntry & { saveKey?: string; saves?: number })[] = [];
  for (const e of sorted) {
    const offset = formatOffset((new Date(e.at).getTime() - start) / 1000);
    if (e.kind === "saved_step") {
      const saveKey = field(e.payload, "stepId") ?? "";
      const last = out[out.length - 1];
      if (last?.saveKey === saveKey) {
        last.saves = (last.saves ?? 1) + 1;
        last.text = `Saved ${step(e.payload)} (${last.saves} times)`;
        continue;
      }
      out.push({ at: e.at, offset, text: `Saved ${step(e.payload)}`, saveKey, saves: 1 });
      continue;
    }

    let text: string;
    switch (e.kind) {
      case "started_attempt": {
        const a = (e.payload as { accommodations?: { extraTimePercent?: unknown; waiveCamera?: unknown; waiveScreen?: unknown } } | null)
          ?.accommodations;
        const applied = a
          ? describeAccommodations(
              readAccommodations({
                extra_time_percent: typeof a.extraTimePercent === "number" ? a.extraTimePercent : 0,
                waive_camera: a.waiveCamera === true,
                waive_screen: a.waiveScreen === true,
              }),
            )
          : [];
        text = applied.length ? `Started the assessment with accommodations: ${applied.join(", ")}` : "Started the assessment";
        break;
      }
      case "opened_message": {
        const id = field(e.payload, "messageId");
        text = `Opened message "${(id && opts.messageSubjects[id]) ?? id ?? "unknown"}"`;
        break;
      }
      case "started_step":
        text = `Started ${step(e.payload)}`;
        break;
      case "submitted_attempt":
        text = field(e.payload, "reason") === "timeout" ? "Time ran out; answers submitted automatically" : "Submitted the assessment";
        break;
      default:
        text = e.kind.replaceAll("_", " ");
    }
    out.push({ at: e.at, offset, text });
  }
  return out.map(({ at, offset, text }) => ({ at, offset, text }));
}
