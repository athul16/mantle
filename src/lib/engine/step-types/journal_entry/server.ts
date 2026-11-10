import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import type { StepScoreItem } from "../../types";
import {
  ACCOUNT_CODE_PATTERN,
  BALANCE_EPSILON,
  JOURNAL_ENTRY,
  MAX_ENTRIES,
  MAX_LINES_PER_ENTRY,
  entryTotals,
  isBalanced,
  journalEntryAnswerSchema,
  type JournalEntryAnswer,
  type JournalEntryPublicConfig,
} from "./public";

const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
/** Expected entries per step; keeps the entry-matching search small. */
const MAX_EXPECTED_ENTRIES = 12;

/**
 * Authored config. `prompt` and account names may contain {{templates}}.
 * `expected` names the entries the key will hold (labels and points for the
 * company report); the lines themselves depend on the variant and live in the key.
 */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    accounts: z
      .array(z.object({ code: z.string().regex(ACCOUNT_CODE_PATTERN), name: z.string().min(1) }).strict())
      .min(2)
      .max(200),
    maxEntries: z.number().int().positive().max(MAX_ENTRIES).default(10),
    maxLines: z.number().int().min(2).max(MAX_LINES_PER_ENTRY).default(6),
    expected: z
      .array(
        z
          .object({
            id: z.string().regex(ID_PATTERN),
            /** Name in the company report, e.g. "Bank service charge". */
            label: z.string().min(1),
            points: z.number().positive().default(3),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_EXPECTED_ENTRIES),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (new Set(c.accounts.map((a) => a.code)).size !== c.accounts.length) {
      ctx.addIssue({ code: "custom", message: "account codes must be unique" });
    }
    if (new Set(c.expected.map((e) => e.id)).size !== c.expected.length) {
      ctx.addIssue({ code: "custom", message: "expected entry ids must be unique" });
    }
  });
export type JournalEntryConfig = z.infer<typeof configSchema>;

/**
 * One expected line. `accounts` lists every acceptable account (usually one;
 * e.g. COGS or Accounts payable when either is defensible). Amounts in dollars.
 */
const keyLineSchema = z
  .object({
    accounts: z.array(z.string().regex(ACCOUNT_CODE_PATTERN)).min(1),
    side: z.enum(["debit", "credit"]),
    amount: z.number().finite().positive(),
  })
  .strict();

/** Expected entries per `expected` id, from the scenario generator. Each must balance. */
const keySchema = z
  .object({
    tolerance: z.number().min(0).default(0.005),
    entries: z.record(z.string().regex(ID_PATTERN), z.object({ lines: z.array(keyLineSchema).min(2) }).strict()),
  })
  .strict()
  .superRefine((k, ctx) => {
    for (const [id, e] of Object.entries(k.entries)) {
      const dr = e.lines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
      const cr = e.lines.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
      if (Math.abs(dr - cr) >= BALANCE_EPSILON) ctx.addIssue({ code: "custom", message: `key entry "${id}" doesn't balance` });
    }
  });
export type JournalEntryKey = z.infer<typeof keySchema>;
type KeyLine = z.infer<typeof keyLineSchema>;

/** A candidate line reduced to what scoring needs; `null` side = not a usable line (both or neither amount). */
interface CandidateLine {
  account: string;
  side: "debit" | "credit" | null;
  amount: number;
}

interface EntryMatch {
  earned: number;
  note: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toCandidateLines(lines: JournalEntryAnswer["entries"][number]["lines"]): CandidateLine[] {
  return lines
    .filter((l) => l.account !== "" || l.debit !== null || l.credit !== null)
    .map((l) => {
      const dr = l.debit !== null && l.debit !== 0;
      const cr = l.credit !== null && l.credit !== 0;
      if (dr === cr) return { account: l.account, side: null, amount: 0 };
      return dr ? { account: l.account, side: "debit", amount: l.debit! } : { account: l.account, side: "credit", amount: l.credit! };
    });
}

/**
 * Scores one candidate entry against one expected entry. Per expected line:
 * full credit for the right account, side and amount; half for the right
 * account and side with a wrong amount. Each candidate line counts once.
 * Every candidate line left over costs half a line, so listing every account
 * can't buy credit. An unbalanced entry earns at most half its points: it
 * couldn't be posted.
 */
function matchEntry(
  expected: KeyLine[],
  lines: CandidateLine[],
  totals: { debit: number; credit: number },
  points: number,
  tolerance: number,
  describe: (l: KeyLine) => string,
): EntryMatch {
  const used = new Set<number>();
  const credit = expected.map(() => 0);
  const status: string[] = expected.map(() => "");
  const fits = (k: KeyLine, c: CandidateLine) => c.side === k.side && k.accounts.includes(c.account);

  expected.forEach((k, i) => {
    const j = lines.findIndex((c, j) => !used.has(j) && fits(k, c) && Math.abs(c.amount - k.amount) <= tolerance + 1e-9);
    if (j >= 0) {
      used.add(j);
      credit[i] = 1;
    }
  });
  expected.forEach((k, i) => {
    if (credit[i]) return;
    const j = lines.findIndex((c, j) => !used.has(j) && fits(k, c));
    if (j >= 0) {
      used.add(j);
      credit[i] = 0.5;
      status[i] = `${describe(k)}: amount ${money(lines[j].amount)}`;
    } else {
      status[i] = `${describe(k)}: missing`;
    }
  });

  const extra = lines.length - used.size;
  let fraction = Math.max(0, (credit.reduce((a, b) => a + b, 0) - 0.5 * extra) / expected.length);
  const balanced = isBalanced(totals);
  if (!balanced) fraction = Math.min(fraction, 0.5);

  const problems = status.filter(Boolean);
  if (extra) problems.push(`${extra} extra line${extra === 1 ? "" : "s"}`);
  if (!balanced) problems.push(`out of balance (debits ${money(totals.debit)}, credits ${money(totals.credit)})`);
  return { earned: round2(points * fraction), note: problems.length ? problems.join("; ") + "." : "Correct." };
}

/**
 * Picks which candidate entry answers which expected entry so the total is
 * highest (candidates may list entries in any order). Exact search over
 * subsets of expected entries; at most 12 expected × 30 candidate entries.
 */
function bestAssignment(value: number[][]): number[] {
  const nExpected = value[0]?.length ?? 0;
  const size = 1 << nExpected;
  // best[mask] = [total, assignment per expected index (-1 = none)]
  let best: { total: number; assign: number[] }[] = Array.from({ length: size }, () => ({ total: -1, assign: [] }));
  best[0] = { total: 0, assign: Array(nExpected).fill(-1) };
  value.forEach((row, c) => {
    const next = best.map((s) => ({ ...s }));
    for (let mask = 0; mask < size; mask++) {
      if (best[mask].total < 0) continue;
      for (let e = 0; e < nExpected; e++) {
        if (mask & (1 << e) || row[e] <= 0) continue;
        const total = best[mask].total + row[e];
        const to = mask | (1 << e);
        if (total > next[to].total + 1e-9) {
          const assign = best[mask].assign.slice();
          assign[e] = c;
          next[to] = { total, assign };
        }
      }
    }
    best = next;
  });
  return best.reduce((a, b) => (b.total > a.total + 1e-9 ? b : a)).assign;
}

export const journalEntryServer: ServerStepType<JournalEntryConfig, JournalEntryPublicConfig, JournalEntryAnswer, JournalEntryKey> = {
  type: JOURNAL_ENTRY,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    return {
      prompt: fill(config.prompt),
      accounts: config.accounts.map((a) => ({ code: a.code, name: fill(a.name) })),
      maxEntries: config.maxEntries,
      maxLines: config.maxLines,
    };
  },

  parseAnswer(raw) {
    return journalEntryAnswerSchema.parse(raw);
  },

  /** One item per expected entry, plus a zero-point item listing unmatched candidate entries for the reviewer. */
  score({ config, key, answer }) {
    const names = new Map(config.accounts.map((a) => [a.code, a.name]));
    const expectedIds = new Set(config.expected.map((e) => e.id));
    for (const id of Object.keys(key.entries)) {
      if (!expectedIds.has(id)) throw new Error(`journal_entry key has unknown entry "${id}"`);
    }
    for (const e of config.expected) {
      const k = key.entries[e.id];
      if (!k) throw new Error(`journal_entry key is missing entry "${e.id}"`);
      for (const l of k.lines) {
        for (const code of l.accounts) if (!names.has(code)) throw new Error(`journal_entry key uses unknown account "${code}"`);
      }
    }

    const describe = (l: KeyLine) =>
      `${l.side === "debit" ? "Dr" : "Cr"} ${l.accounts.map((c) => `${c} ${names.get(c)}`).join(" or ")} ${money(l.amount)}`;
    const candidates = (answer?.entries ?? [])
      .map((e) => ({ lines: toCandidateLines(e.lines), totals: entryTotals(e.lines) }))
      .filter((e) => e.lines.length > 0);

    const matches = candidates.map((c) =>
      config.expected.map((e) => matchEntry(key.entries[e.id].lines, c.lines, c.totals, e.points, key.tolerance, describe)),
    );
    const assign = bestAssignment(matches.map((row) => row.map((m) => m.earned)));

    const items: StepScoreItem[] = config.expected.map((e, i) => {
      const base = { id: e.id, label: e.label, max: e.points };
      const c = assign[i] ?? -1;
      if (c < 0) {
        return { ...base, earned: 0, note: `No matching entry. Expected ${key.entries[e.id].lines.map(describe).join(", ")}.` };
      }
      return { ...base, earned: matches[c][i].earned, note: matches[c][i].note };
    });

    const unmatched = candidates.length - assign.filter((c) => c >= 0).length;
    if (unmatched > 0) {
      items.push({
        id: "unmatched-entries",
        label: "Entries not in the key",
        earned: 0,
        max: 0,
        note: `${unmatched} entr${unmatched === 1 ? "y" : "ies"} didn't match any expected entry. Not penalised; review if needed.`,
      });
    }

    return {
      points: round2(items.reduce((sum, i) => sum + i.earned, 0)),
      maxPoints: items.reduce((sum, i) => sum + i.max, 0),
      items,
    };
  },
};
