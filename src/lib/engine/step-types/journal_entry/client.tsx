"use client";

import { useState } from "react";
import type { StepComponentProps } from "../../types";
import { parseCellInput } from "../spreadsheet/public";
import { entryTotals, isBalanced, type JournalEntryAnswer, type JournalEntryPublicConfig } from "./public";

/** Raw text per line so "12." or "(" can be typed without being normalised away. */
interface LineDraft {
  account: string;
  debit: string;
  credit: string;
}
interface EntryDraft {
  memo: string;
  lines: LineDraft[];
}

const blankLine = (): LineDraft => ({ account: "", debit: "", credit: "" });
const blankEntry = (): EntryDraft => ({ memo: "", lines: [blankLine(), blankLine()] });
const num = (n: number | null) => (n == null ? "" : String(n));
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toAnswer(drafts: EntryDraft[]): JournalEntryAnswer {
  return {
    entries: drafts.map((e) => ({
      memo: e.memo,
      lines: e.lines.map((l) => ({ account: l.account, debit: parseCellInput(l.debit), credit: parseCellInput(l.credit) })),
    })),
  };
}

/**
 * Browser half of the `journal_entry` step type: one or more entries, each a
 * table of account / debit / credit lines with running totals and a balance
 * check. The check is a hint for the candidate; scoring re-checks on the server.
 */
export function JournalEntryStep({
  config,
  answer,
  onChange,
  disabled,
}: StepComponentProps<JournalEntryPublicConfig, JournalEntryAnswer>) {
  const [drafts, setDrafts] = useState<EntryDraft[]>(() =>
    answer?.entries.length
      ? answer.entries.map((e) => ({
          memo: e.memo,
          lines: e.lines.map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit) })),
        }))
      : [blankEntry()],
  );

  const update = (next: EntryDraft[]) => {
    setDrafts(next);
    onChange(toAnswer(next));
  };
  const setEntry = (i: number, entry: EntryDraft) => update(drafts.map((e, j) => (j === i ? entry : e)));
  const setLine = (i: number, k: number, patch: Partial<LineDraft>) =>
    setEntry(i, { ...drafts[i], lines: drafts[i].lines.map((l, j) => (j === k ? { ...l, ...patch } : l)) });

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 whitespace-pre-line">{config.prompt}</p>

      {drafts.map((entry, i) => {
        const parsed = entry.lines.map((l) => ({ debit: parseCellInput(l.debit), credit: parseCellInput(l.credit) }));
        const totals = entryTotals(parsed);
        const empty = totals.debit === 0 && totals.credit === 0;
        const balanced = isBalanced(totals);
        const n = i + 1;
        return (
          <fieldset key={i} className="space-y-2 rounded border border-neutral-300 p-3 dark:border-neutral-700">
            <legend className="px-1 text-sm font-semibold">Entry {n}</legend>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["Account", "Debit", "Credit", ""].map((h, c) => (
                    <th
                      key={c}
                      scope="col"
                      className="border border-neutral-300 bg-neutral-100 px-2 py-1 text-left font-medium dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((line, k) => {
                  const where = `entry ${n}, line ${k + 1}`;
                  const cell = "border border-neutral-300 p-0 dark:border-neutral-700";
                  const amount =
                    "w-full min-w-24 bg-yellow-50 px-2 py-1 text-right font-mono outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset dark:bg-yellow-950/30";
                  return (
                    <tr key={k}>
                      <td className={cell}>
                        <select
                          aria-label={`Account, ${where}`}
                          disabled={disabled}
                          value={line.account}
                          onChange={(e) => setLine(i, k, { account: e.target.value })}
                          className="w-full min-w-48 bg-yellow-50 px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset dark:bg-yellow-950/30"
                        >
                          <option value="">Choose account…</option>
                          {config.accounts.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={cell}>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Debit, ${where}`}
                          disabled={disabled}
                          value={line.debit}
                          placeholder="0.00"
                          onChange={(e) => setLine(i, k, { debit: e.target.value })}
                          className={amount}
                        />
                      </td>
                      <td className={cell}>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Credit, ${where}`}
                          disabled={disabled}
                          value={line.credit}
                          placeholder="0.00"
                          onChange={(e) => setLine(i, k, { credit: e.target.value })}
                          className={amount}
                        />
                      </td>
                      <td className="border border-neutral-300 px-1 text-center dark:border-neutral-700">
                        <button
                          type="button"
                          aria-label={`Remove ${where}`}
                          disabled={disabled || entry.lines.length <= 2}
                          onClick={() => setEntry(i, { ...entry, lines: entry.lines.filter((_, j) => j !== k) })}
                          className="px-1 text-neutral-500 hover:text-red-600 disabled:opacity-30"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-mono">
                  <th scope="row" className="px-2 py-1 text-left font-sans font-medium">
                    Total
                  </th>
                  <td className="px-2 py-1 text-right">{money(totals.debit)}</td>
                  <td className="px-2 py-1 text-right">{money(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p
              role="status"
              className={`text-xs ${empty ? "text-neutral-500" : balanced ? "text-green-700 dark:text-green-400" : "text-red-600"}`}
            >
              {empty
                ? "No amounts yet."
                : balanced
                  ? "Balanced."
                  : `Out of balance by ${money(Math.abs(totals.debit - totals.credit))}.`}
            </p>
            <label className="block text-xs text-neutral-600 dark:text-neutral-400">
              Description (optional)
              <input
                type="text"
                maxLength={500}
                disabled={disabled}
                value={entry.memo}
                onChange={(e) => setEntry(i, { ...entry, memo: e.target.value })}
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <div className="flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                disabled={disabled || entry.lines.length >= config.maxLines}
                onClick={() => setEntry(i, { ...entry, lines: [...entry.lines, blankLine()] })}
                className="underline disabled:opacity-40"
              >
                Add line to entry {n}
              </button>
              <button
                type="button"
                disabled={disabled || drafts.length <= 1}
                onClick={() => update(drafts.filter((_, j) => j !== i))}
                className="text-red-600 underline disabled:opacity-40"
              >
                Delete entry {n}
              </button>
            </div>
          </fieldset>
        );
      })}

      <button
        type="button"
        disabled={disabled || drafts.length >= config.maxEntries}
        onClick={() => update([...drafts, blankEntry()])}
        className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-neutral-700"
      >
        Add entry
      </button>
      <p className="text-xs text-neutral-500">
        Pick an account and enter each amount in either the Debit or the Credit column. Each entry must balance.
      </p>
    </div>
  );
}
