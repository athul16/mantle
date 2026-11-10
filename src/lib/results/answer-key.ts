import "server-only";

import { getServerStepType } from "@/lib/engine/server/registry";
import { rubricCriteria, type InboxReplyConfig, type InboxReplyKey } from "@/lib/engine/step-types/inbox_reply/server";
import { inputCells, type SpreadsheetConfig, type SpreadsheetKey } from "@/lib/engine/step-types/spreadsheet/server";
import type { NumericConfig, NumericKey } from "@/lib/engine/step-types/numeric/server";
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
