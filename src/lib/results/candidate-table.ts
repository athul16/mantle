import { candidateLabel, formatDuration, type ResultRow } from "./summary";

// Pure helpers for the job candidates table (screen 6): the extra columns the
// prototype shows next to the basic results row, and their filters and CSV.
// No database, no answer keys: safe to import from client components.

export type IntegrityLabel = "clear" | "review" | "suspicious";

/** Points earned on one task, in scenario order. */
export type TaskScore = { stepId: string; title: string; points: number; maxPoints: number };

export type CandidateRow = ResultRow & {
  startedAt: string | null;
  expiresAt: string;
  /** attempts.integrity_label, set by the proctoring rules when the attempt ends. */
  integrity: IntegrityLabel | null;
  /** Flags raised on the attempt, any review status. */
  flagCount: number;
  hireVotes: number;
  noHireVotes: number;
  /** Per-task points from the stored score; empty until scored. */
  tasks: TaskScore[];
  /** True when every task still waiting for review is a written reply. */
  replyToScore: boolean;
  /** Percentile rank among scored candidates in the same job; null until two are scored. */
  percentile: number | null;
};

/**
 * Percentile rank of each scored row among the scored rows: the share scoring
 * lower, counting ties as half, clamped to 1–99 (the prototype's convention).
 * Needs at least two scored candidates; otherwise every value is null.
 */
export function percentiles(rows: readonly Pick<ResultRow, "inviteId" | "percent">[]): Map<string, number> {
  const scored = rows.filter((r) => r.percent !== null) as { inviteId: string; percent: number }[];
  const out = new Map<string, number>();
  if (scored.length < 2) return out;
  for (const r of scored) {
    const below = scored.filter((o) => o.percent < r.percent).length;
    const ties = scored.filter((o) => o !== r && o.percent === r.percent).length;
    const rank = Math.round((100 * (below + ties / 2)) / (scored.length - 1));
    out.set(r.inviteId, Math.max(1, Math.min(99, rank)));
  }
  return out;
}

/** 1 → "1st", 22 → "22nd", 90 → "90th". */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** A score out of 100 as the table shows it: "88", "42.1". */
export function formatScore(percent: number | null): string {
  if (percent === null) return "—";
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

export const SCORE_FILTERS = ["any", "pass", "90", "70", "below70"] as const;
export type ScoreFilter = (typeof SCORE_FILTERS)[number];

export function scoreFilterLabel(f: ScoreFilter, passScore: number | null): string {
  return {
    any: "Score: Any",
    pass: `Score: ${passScore ?? "—"}+ (pass mark)`,
    "90": "Score: 90–100",
    "70": "Score: 70–100",
    below70: "Score: below 70",
  }[f];
}

export const INTEGRITY_FILTERS = ["any", "clear", "review", "suspicious"] as const;
export type IntegrityFilter = (typeof INTEGRITY_FILTERS)[number];
export const INTEGRITY_FILTER_LABELS: Record<IntegrityFilter, string> = {
  any: "Integrity: Any",
  clear: "Integrity: Clear",
  review: "Integrity: Review",
  suspicious: "Integrity: Suspicious",
};

/** Score and integrity filters; rows without a score or label only pass "any". */
export function filterExtra(rows: readonly CandidateRow[], score: ScoreFilter, integrity: IntegrityFilter, passScore: number | null): CandidateRow[] {
  return rows.filter((r) => {
    if (score !== "any") {
      if (r.percent === null) return false;
      if (score === "pass" && (passScore === null || r.percent < passScore)) return false;
      if (score === "90" && r.percent < 90) return false;
      if (score === "70" && r.percent < 70) return false;
      if (score === "below70" && r.percent >= 70) return false;
    }
    if (integrity !== "any" && r.integrity !== integrity) return false;
    return true;
  });
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export type CsvOptions = { scores: boolean; integrity: boolean; votes: boolean };

/**
 * One row per candidate. Cells starting with = + - @ are prefixed with a quote
 * so spreadsheet apps don't run them as formulas.
 */
export function buildCsv(rows: readonly CandidateRow[], opts: CsvOptions): string {
  const taskTitles = rows.find((r) => r.tasks.length)?.tasks.map((t) => t.title) ?? [];
  const head = ["Candidate", "Email", "Status", "Time taken", "Submitted"];
  if (opts.scores) head.push("Score (of 100)", "Points", "Max points", "Percentile", "Needs review", ...taskTitles);
  if (opts.integrity) head.push("Integrity", "Flags");
  if (opts.votes) head.push("Hire votes", "No-hire votes");
  const lines = [head.map(csvCell)];
  for (const r of rows) {
    const line: (string | number | null)[] = [candidateLabel(r), r.email, r.status, r.timeTakenSeconds === null ? null : formatDuration(r.timeTakenSeconds), r.submittedAt];
    if (opts.scores) {
      line.push(r.percent, r.points, r.maxPoints, r.percentile, r.needsReview ? "yes" : r.percent === null ? null : "no");
      for (const title of taskTitles) {
        const t = r.tasks.find((x) => x.title === title);
        line.push(t ? `${t.points}/${t.maxPoints}` : null);
      }
    }
    if (opts.integrity) line.push(r.integrity, r.integrity ? r.flagCount : null);
    if (opts.votes) line.push(r.hireVotes, r.noHireVotes);
    lines.push(line.map(csvCell));
  }
  return lines.map((l) => l.join(",")).join("\r\n") + "\r\n";
}
