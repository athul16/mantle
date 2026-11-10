import "server-only";

import { getServerStepType } from "@/lib/engine/server/registry";
import { rubricCriteria, type InboxReplyConfig, type InboxReplyKey } from "@/lib/engine/step-types/inbox_reply/server";
import { inputCells, type SpreadsheetConfig, type SpreadsheetKey } from "@/lib/engine/step-types/spreadsheet/server";
import type { NumericConfig, NumericKey } from "@/lib/engine/step-types/numeric/server";
import { journalEntryServer, type JournalEntryConfig, type JournalEntryKey } from "@/lib/engine/step-types/journal_entry/server";
import type { JournalEntryAnswer } from "@/lib/engine/step-types/journal_entry/public";
import { documentReviewServer, type DocumentReviewConfig, type DocumentReviewKey } from "@/lib/engine/step-types/document_review/server";
import type { DocumentReviewAnswer } from "@/lib/engine/step-types/document_review/public";
import { fillTemplate } from "@/lib/engine/server/template";
import type { Step, Variant } from "@/lib/engine/types";
import type { StoredStepScore } from "./summary";

// Builds the "candidate's answer next to the expected answer" view of one step
// for the company report. Reads answer keys, so it is server only, and the
// result is rendered only on org-member pages.

export type StepRow = {
  id: string;
  label: string;
  answer: string;
  expected: string;
  earned?: number;
  max?: number;
  note?: string;
};

export type StepDetail = {
  id: string;
  title: string;
  type: string;
  score: StoredStepScore | null;
  /** Free text the candidate wrote (inbox reply), or a raw dump for step types without a custom view. */
  answerText: string | null;
  rows: StepRow[];
};

const NOT_ANSWERED = "(not answered)";

function money(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function plain(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

function withScore(rows: Omit<StepRow, "earned" | "max" | "note">[], score: StoredStepScore | null): StepRow[] {
  const items = new Map((score?.items ?? []).map((i) => [i.id, i]));
  return rows.map((r) => {
    const item = items.get(r.id);
    return item ? { ...r, earned: item.earned, max: item.max, note: item.note } : r;
  });
}

export function describeStep(step: Step, variant: Variant | null, answer: unknown, score: StoredStepScore | null): StepDetail {
  const base = { id: step.id, title: step.title, type: step.type, score };
  let stepType;
  try {
    stepType = getServerStepType(step.type);
  } catch {
    return { ...base, answerText: answer === undefined ? null : JSON.stringify(answer, null, 2), rows: withScore([], score) };
  }
  const config = stepType.configSchema.parse(step.config);
  const key = variant ? stepType.keySchema.parse(variant.keys[step.id]) : null;

  switch (step.type) {
    case "numeric": {
      const c = config as NumericConfig;
      const k = key as NumericKey | null;
      const value = obj(answer).value;
      const fmt = (n: number) => {
        const text = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
        const sign = n < 0 ? "-" : "";
        if (!c.unit) return sign + text;
        return c.unit === "$" ? `${sign}$${text}` : `${sign}${text} ${c.unit}`;
      };
      // A tolerance below the last shown decimal only absorbs rounding; don't show it.
      const showTolerance = !!k && k.tolerance >= 10 ** -c.decimals;
      const expected = k ? fmt(k.value) + (showTolerance ? ` (± ${plain(k.tolerance)})` : "") : "—";
      return {
        ...base,
        answerText: null,
        rows: withScore([{ id: "value", label: "Value", answer: typeof value === "number" ? fmt(value) : NOT_ANSWERED, expected }], score),
      };
    }

    case "spreadsheet": {
      const c = config as SpreadsheetConfig;
      const k = key as SpreadsheetKey | null;
      const cells = obj(obj(answer).cells);
      const keyed = inputCells(c).filter((cell) => !k || cell.input in k.cells);
      const fmt = (n: number, format: "money" | "number") => (format === "money" ? money(n) : plain(n));
      return {
        ...base,
        answerText: null,
        rows: withScore(
          keyed.map((cell) => {
            const given = cells[cell.input];
            const want = k?.cells[cell.input];
            return {
              id: cell.input,
              label: cell.label ?? cell.input,
              answer: typeof given === "number" ? fmt(given, cell.format) : NOT_ANSWERED,
              expected: want ? fmt(want.value, cell.format) : "—",
            };
          }),
          score,
        ),
      };
    }

    case "inbox_reply": {
      const c = config as InboxReplyConfig;
      const k = (key as InboxReplyKey | null) ?? { notes: {} };
      const body = obj(answer).body;
      const criteria = variant ? rubricCriteria(c, k, variant.values) : c.criteria.map((x) => ({ ...x, reference: undefined }));
      return {
        ...base,
        answerText: typeof body === "string" && body.trim() ? body : null,
        rows: withScore(
          criteria.map((cr) => ({
            id: cr.id,
            label: cr.label,
            answer: "",
            expected: cr.guidance + (cr.reference ? ` Reference: ${cr.reference}` : ""),
          })),
          score,
        ),
      };
    }

    case "journal_entry":
      return { ...base, answerText: null, rows: journalEntryRows(config as JournalEntryConfig, key as JournalEntryKey | null, variant, answer, score) };

    case "document_review":
      return { ...base, answerText: null, rows: documentReviewRows(config as DocumentReviewConfig, key as DocumentReviewKey | null, variant, answer, score) };

    default:
      // Step types without a custom view yet (e.g. ones added after this
      // report): the raw answer, the raw key, and the scored items.
      return {
        ...base,
        answerText: answer === undefined ? null : JSON.stringify(answer, null, 2),
        rows: [
          ...withScore([], score),
          ...(key ? [{ id: "__key", label: "Expected (answer key)", answer: "", expected: JSON.stringify(key) }] : []),
          ...(score?.items ?? []).map((i) => ({ id: i.id, label: i.label, answer: "", expected: "", earned: i.earned, max: i.max, note: i.note })),
        ],
      };
  }
}

type JournalLine = JournalEntryAnswer["entries"][number]["lines"][number];

/**
 * One row per expected entry (the candidate entry the scorer matched to it,
 * next to the key's lines), then "Entries not in the key". Points and notes
 * come from the stored score; the matching only picks which entry to show.
 */
function journalEntryRows(
  c: JournalEntryConfig,
  k: JournalEntryKey | null,
  variant: Variant | null,
  answer: unknown,
  score: StoredStepScore | null,
): StepRow[] {
  const fill = (t: string) => (variant ? fillTemplate(t, variant.values) : t);
  const names = new Map(c.accounts.map((a) => [a.code, fill(a.name)]));
  const account = (code: string) => (code ? `${code} ${names.get(code) ?? ""}`.trim() : "(no account)");
  const parsed = answer === undefined ? null : safeParse(() => journalEntryServer.parseAnswer(answer));
  const entries = (parsed?.entries ?? []).filter((e) => e.lines.some(isUsedLine));

  const showLine = (l: JournalLine) => {
    const dr = l.debit !== null && l.debit !== 0;
    const cr = l.credit !== null && l.credit !== 0;
    if (dr && !cr) return `Dr ${account(l.account)} ${money(l.debit!)}`;
    if (cr && !dr) return `Cr ${account(l.account)} ${money(l.credit!)}`;
    if (dr && cr) return `${account(l.account)} Dr ${money(l.debit!)} Cr ${money(l.credit!)}`;
    return `${account(l.account)} (no amount)`;
  };
  const showEntry = (e: (typeof entries)[number]) =>
    e.lines.filter(isUsedLine).map(showLine).join("; ") + (e.memo.trim() ? ` (memo: "${e.memo.trim()}")` : "");

  // Same assignment the scorer makes: score each candidate entry against each
  // expected entry alone, then pick the best overall pairing.
  let assign: number[] = c.expected.map(() => -1);
  if (k && entries.length) {
    const value = entries.map((e) =>
      c.expected.map((x) => {
        const one = journalEntryServer.score({
          config: { ...c, expected: [x] },
          key: { ...k, entries: { [x.id]: k.entries[x.id] } },
          variant: variant ?? { values: {}, keys: {} },
          answer: { entries: [e] },
        });
        return one.items[0]?.earned ?? 0;
      }),
    );
    assign = bestAssignment(value, c.expected.length);
  }

  const rows: Omit<StepRow, "earned" | "max" | "note">[] = c.expected.map((x, i) => {
    const want = k?.entries[x.id];
    return {
      id: x.id,
      label: x.label,
      answer: !entries.length ? NOT_ANSWERED : assign[i] >= 0 ? showEntry(entries[assign[i]]) : "(no matching entry)",
      expected: want
        ? want.lines.map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.accounts.map(account).join(" or ")} ${money(l.amount)}`).join("; ")
        : "—",
    };
  });

  const matched = new Set(assign.filter((j) => j >= 0));
  const leftover = entries.filter((_, j) => !matched.has(j));
  const scoredExtra = score?.items.some((i) => i.id === "unmatched-entries");
  if (leftover.length || scoredExtra) {
    rows.push({ id: "unmatched-entries", label: "Entries not in the key", answer: leftover.map(showEntry).join(" | ") || "—", expected: "—" });
  }
  return withScore(rows, score);
}

function isUsedLine(l: JournalLine) {
  return l.account !== "" || l.debit !== null || l.credit !== null;
}

function safeParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Highest-total pairing of candidate entries (rows) to expected entries (columns); -1 = unmatched. Mirrors the journal_entry scorer. */
function bestAssignment(value: number[][], nExpected: number): number[] {
  const size = 1 << nExpected;
  let best: { total: number; assign: number[] }[] = Array.from({ length: size }, () => ({ total: -1, assign: [] }));
  best[0] = { total: 0, assign: Array(nExpected).fill(-1) };
  value.forEach((row, cand) => {
    const next = best.map((s) => ({ ...s }));
    for (let mask = 0; mask < size; mask++) {
      if (best[mask].total < 0) continue;
      for (let e = 0; e < nExpected; e++) {
        if (mask & (1 << e) || row[e] <= 0) continue;
        const total = best[mask].total + row[e];
        const to = mask | (1 << e);
        if (total > next[to].total + 1e-9) {
          const assign = best[mask].assign.slice();
          assign[e] = cand;
          next[to] = { total, assign };
        }
      }
    }
    best = next;
  });
  return best.reduce((a, b) => (b.total > a.total + 1e-9 ? b : a)).assign;
}

/**
 * One row per finding (the flag the scorer credited, next to the expected item
 * and reason), the decision, then "False flags" with its deduction.
 */
function documentReviewRows(
  c: DocumentReviewConfig,
  k: DocumentReviewKey | null,
  variant: Variant | null,
  answer: unknown,
  score: StoredStepScore | null,
): StepRow[] {
  const fill = (t: string) => (variant ? fillTemplate(t, variant.values) : t);
  const d = c.document;
  const labels = new Map<string, string>([
    ...d.fields.map((f) => [f.id, fill(f.label)] as const),
    ...d.rows.map((r) => [r.id, `line "${fill(r.cells[0] ?? r.id)}"`] as const),
    ...d.totals.map((f) => [f.id, fill(f.label)] as const),
  ]);
  const reasonLabel = new Map(c.reasons.map((r) => [r.id, fill(r.label)]));
  const reason = (id: string) => (id ? (reasonLabel.get(id) ?? id) : "no reason");
  const parsed = answer === undefined ? null : safeParse(() => documentReviewServer.parseAnswer(answer));
  const flags = (parsed?.flags ?? []).filter((f) => labels.has(f.target));
  const showFlag = (f: DocumentReviewAnswer["flags"][number]) =>
    `${labels.get(f.target)}: ${reason(f.reason)}` + (f.note?.trim() ? ` (note: "${f.note.trim()}")` : "");

  // Same matching as the scorer: right item and reason first, then right item only.
  const used = new Set<number>();
  const credited = new Map<string, number>();
  if (k) {
    for (const pass of ["exact", "item"] as const) {
      for (const f of c.findings) {
        const fk = k.findings[f.id];
        if (credited.has(f.id) || !fk) continue;
        const j = flags.findIndex((fl, j) => !used.has(j) && fk.targets.includes(fl.target) && (pass === "item" || fk.reasons.includes(fl.reason)));
        if (j >= 0) {
          used.add(j);
          credited.set(f.id, j);
        }
      }
    }
  }

  const rows: Omit<StepRow, "earned" | "max" | "note">[] = c.findings.map((f) => {
    const fk = k?.findings[f.id];
    const j = credited.get(f.id);
    return {
      id: f.id,
      label: f.label,
      answer: j === undefined ? "(not flagged)" : showFlag(flags[j]),
      expected: fk
        ? `${fk.targets.map((t) => labels.get(t) ?? t).join(" or ")}: ${fk.reasons.map(reason).join(" or ")}` + (fk.note ? `. ${fill(fk.note)}` : "")
        : "—",
    };
  });

  if (c.decision) {
    const option = (id: string) => fill(c.decision!.options.find((o) => o.id === id)?.label ?? id);
    const chosen = parsed?.decision ?? null;
    rows.push({
      id: "decision",
      label: "Decision",
      answer: chosen ? option(chosen) : NOT_ANSWERED,
      expected: k?.decision ? k.decision.map(option).join(" or ") : "—",
    });
  }

  const issueItems = new Set(Object.values(k?.findings ?? {}).flatMap((fk) => fk.targets));
  const falseFlags = k ? flags.filter((f, j) => !used.has(j) && !issueItems.has(f.target)) : [];
  if (falseFlags.length || score?.items.some((i) => i.id === "false-flags")) {
    rows.push({ id: "false-flags", label: "False flags", answer: falseFlags.map(showFlag).join("; ") || "—", expected: "None" });
  }
  return withScore(rows, score);
}
