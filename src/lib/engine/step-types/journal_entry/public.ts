/**
 * `journal_entry` step type, browser-safe part: the chart of accounts the
 * candidate picks from and the shape of the entries they submit. Expected
 * entries, points and tolerances live in the server key.
 */
import { z } from "zod";

export const JOURNAL_ENTRY = "journal_entry";

/** Account codes, e.g. "1010". Shared by config, key and answer. */
export const ACCOUNT_CODE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
/** Upper bounds so autosave can't be used to stuff the database. */
export const MAX_ENTRIES = 30;
export const MAX_LINES_PER_ENTRY = 20;
export const MAX_MEMO_CHARS = 500;
/** Debits and credits within half a cent count as equal. */
export const BALANCE_EPSILON = 0.005;

export interface JournalAccount {
  code: string;
  name: string;
}

export interface JournalEntryPublicConfig {
  prompt: string;
  accounts: JournalAccount[];
  /** How many entries / lines per entry the candidate may add (never above the caps above). */
  maxEntries: number;
  maxLines: number;
}

const lineSchema = z
  .object({
    /** "" while the candidate hasn't picked an account yet. */
    account: z.union([z.literal(""), z.string().regex(ACCOUNT_CODE_PATTERN)]),
    debit: z.number().finite().nullable(),
    credit: z.number().finite().nullable(),
  })
  .strict();

export const journalEntryAnswerSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            lines: z.array(lineSchema).max(MAX_LINES_PER_ENTRY),
            memo: z.string().max(MAX_MEMO_CHARS).default(""),
          })
          .strict(),
      )
      .max(MAX_ENTRIES),
  })
  .strict();

export type JournalEntryAnswer = z.infer<typeof journalEntryAnswerSchema>;
export type JournalLineAnswer = JournalEntryAnswer["entries"][number]["lines"][number];

/** Debit and credit totals of one entry, ignoring blank amounts. Shared so the view and the scorer agree. */
export function entryTotals(lines: readonly Pick<JournalLineAnswer, "debit" | "credit">[]): { debit: number; credit: number } {
  return lines.reduce<{ debit: number; credit: number }>(
    (t, l) => ({ debit: t.debit + (l.debit ?? 0), credit: t.credit + (l.credit ?? 0) }),
    { debit: 0, credit: 0 },
  );
}

/** Balanced means debits equal credits (to the half cent) and the entry isn't empty. */
export function isBalanced(totals: { debit: number; credit: number }): boolean {
  return totals.debit > 0 && Math.abs(totals.debit - totals.credit) < BALANCE_EPSILON;
}
