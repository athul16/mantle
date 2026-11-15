"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
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
 * Browser half of the `journal_entry` step type: a journal sheet in the
 * workbook style. Each entry is a block of account / debit / credit lines
 * with a balance check; totals run along the bottom. The check is a hint for
 * the candidate; scoring re-checks on the server. The prompt is shown by the
 * page (the workspace's brief column).
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

  const grand = drafts.reduce(
    (t, e) => {
      const s = entryTotals(e.lines.map((l) => ({ debit: parseCellInput(l.debit), credit: parseCellInput(l.credit) })));
      return { debit: t.debit + s.debit, credit: t.credit + s.credit };
    },
    { debit: 0, credit: 0 },
  );

  let rowNo = 1;
  return (
    <div className="sheet-step" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="gridwrap">
        <table className="sheet">
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 300 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="rh">
                <span className="sr">Row</span>
              </th>
              {["A", "B", "C", "D", "E", "F", ""].map((l, i) => (
                <th key={i} aria-hidden="true">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{rowNo++}</th>
              <td className="ro head">Entry</td>
              <td className="ro head">Description</td>
              <td className="ro head">Account</td>
              <td className="ro head" style={{ textAlign: "right" }}>
                Debit
              </td>
              <td className="ro head" style={{ textAlign: "right" }}>
                Credit
              </td>
              <td className="ro head">Check</td>
              <td className="ro" />
            </tr>
          </tbody>
          {drafts.map((entry, i) => {
              const parsed = entry.lines.map((l) => ({ debit: parseCellInput(l.debit), credit: parseCellInput(l.credit) }));
              const totals = entryTotals(parsed);
              const empty = totals.debit === 0 && totals.credit === 0;
              const balanced = isBalanced(totals);
              const n = i + 1;
              return (
                <tbody key={i} role="group" aria-label={`Entry ${n}`}>
                  {entry.lines.map((line, k) => {
                    const where = `entry ${n}, line ${k + 1}`;
                    const last = k === entry.lines.length - 1;
                    return (
                      <tr key={k} className={k === 0 ? "estart" : undefined}>
                        <th scope="row">{rowNo++}</th>
                        <td className="ro">
                          {k === 0 ? (
                            <span className="row g4">
                              #{n}
                              {drafts.length > 1 ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  style={{ width: 22, height: 22, marginLeft: "auto" }}
                                  aria-label={`Delete entry ${n}`}
                                  title={`Delete entry ${n}`}
                                  disabled={disabled}
                                  onClick={() => update(drafts.filter((_, j) => j !== i))}
                                >
                                  <Icon name="trash" className="i-sm" />
                                </button>
                              ) : null}
                            </span>
                          ) : (
                            ""
                          )}
                        </td>
                        {k === 0 ? (
                          <td className="ed">
                            <input
                              type="text"
                              maxLength={500}
                              disabled={disabled}
                              value={entry.memo}
                              aria-label={`Description (optional), entry ${n}`}
                              placeholder="Description (optional)"
                              onChange={(e) => setEntry(i, { ...entry, memo: e.target.value })}
                              className="cell"
                            />
                          </td>
                        ) : (
                          <td className="ro" />
                        )}
                        <td className="ed">
                          <select
                            aria-label={`Account, ${where}`}
                            disabled={disabled}
                            value={line.account}
                            onChange={(e) => setLine(i, k, { account: e.target.value })}
                            className="cell"
                          >
                            <option value="">Choose account…</option>
                            {config.accounts.map((a) => (
                              <option key={a.code} value={a.code}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="ed">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={`Debit, ${where}`}
                            disabled={disabled}
                            value={line.debit}
                            onChange={(e) => setLine(i, k, { debit: e.target.value })}
                            className="cell num"
                          />
                        </td>
                        <td className="ed">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={`Credit, ${where}`}
                            disabled={disabled}
                            value={line.credit}
                            onChange={(e) => setLine(i, k, { credit: e.target.value })}
                            className="cell num"
                          />
                        </td>
                        <td>
                          {k === 0 ? (
                            <span role="status">
                              {empty ? (
                                <span className="xs muted">Empty</span>
                              ) : balanced ? (
                                <span className="jst ok">
                                  <Icon name="check" className="i-sm" />
                                  Balanced
                                </span>
                              ) : (
                                <span className="jst warn">
                                  <Icon name="alert" className="i-sm" />
                                  Off by {money(Math.abs(totals.debit - totals.credit))}
                                </span>
                              )}
                            </span>
                          ) : last ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ height: 26, color: "var(--accent)" }}
                              aria-label={`Add line to entry ${n}`}
                              disabled={disabled || entry.lines.length >= config.maxLines}
                              onClick={() => setEntry(i, { ...entry, lines: [...entry.lines, blankLine()] })}
                            >
                              <Icon name="plus" className="i-sm" />
                              Line
                            </button>
                          ) : null}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {entry.lines.length > 2 ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              style={{ width: 26, height: 26 }}
                              aria-label={`Remove ${where}`}
                              title="Remove line"
                              disabled={disabled}
                              onClick={() => setEntry(i, { ...entry, lines: entry.lines.filter((_, j) => j !== k) })}
                            >
                              <Icon name="x" className="i-sm" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          <tbody>
            <tr className="estart">
              <th scope="row">{rowNo++}</th>
              <td className="ro lbl" colSpan={3}>
                Totals
              </td>
              <td className="ro num" style={{ fontWeight: 600 }} data-testid="total-debit">
                {grand.debit ? money(grand.debit) : "—"}
              </td>
              <td className="ro num" style={{ fontWeight: 600 }} data-testid="total-credit">
                {grand.credit ? money(grand.credit) : "—"}
              </td>
              <td className="ro" />
              <td className="ro" />
            </tr>
          </tbody>
        </table>
        <div className="row g10" style={{ padding: "12px 14px" }}>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Add entry"
            disabled={disabled || drafts.length >= config.maxEntries}
            onClick={() => update([...drafts, blankEntry()])}
          >
            <Icon name="plus" />
            New entry
          </button>
          <span className="xs muted">Pick an account and enter each amount as a debit or a credit. Each entry must balance.</span>
        </div>
      </div>
    </div>
  );
}
