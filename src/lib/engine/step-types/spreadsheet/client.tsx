"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { StepComponentProps } from "../../types";
import { parseCellInput, type PublicCell, type SpreadsheetAnswer, type SpreadsheetPublicConfig } from "./public";

/** Spreadsheet-style column letter for column index `c` (A, B, … Z, AA). */
function colLetter(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A bold text cell with nothing after it in the row is a section title; it spans the row like a merged cell. */
function sectionSpan(row: PublicCell[]): number {
  const [first, ...rest] = row;
  if (first?.kind !== "text" || !first.bold) return 0;
  return rest.every((c) => !c || c.kind === "empty") && rest.length > 0 ? row.length : 0;
}

/**
 * Browser half of the `spreadsheet` step type: a read-only/editable grid in the
 * workbook style (grey cells are read-only, white underlined cells are yours).
 * Input cells take numbers. Enter / arrow up / arrow down move between input
 * cells in the same column; Tab goes to the next cell. No formulas: only values
 * are scored. The prompt is shown by the page (the workspace's brief column).
 */
export function SpreadsheetStep({
  config,
  answer,
  onChange,
  disabled,
}: StepComponentProps<SpreadsheetPublicConfig, SpreadsheetAnswer>) {
  // Raw text per cell so "12." or "(" can be typed without being normalised away.
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(answer?.cells ?? {}).map(([id, v]) => [id, v == null ? "" : String(v)])),
  );
  const [focus, setFocus] = useState<{ ref: string; id: string } | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  // Column letters double as headers when the scenario's columns are letters already.
  const lettered = config.columns.every((c, i) => c === colLetter(i));

  const update = (id: string, raw: string) => {
    const next = { ...text, [id]: raw };
    setText(next);
    onChange({ cells: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, parseCellInput(v)])) });
  };

  const move = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" || e.key === "Enter" ? 1 : 0;
    if (step === 0) return;
    for (let r = row + step; r >= 0 && r < config.rows.length; r += step) {
      const target = gridRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${col}"]`);
      if (target) {
        e.preventDefault();
        target.focus();
        target.select();
        return;
      }
    }
  };

  const focusText = focus ? text[focus.id] ?? "" : "";

  return (
    <div className="sheet-step" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="fxbar" aria-hidden="true">
        <span className="ref">{focus?.ref ?? ""}</span>
        <span className="fx">fx</span>
        <span className="val">{focus ? focusText || <span className="muted">Empty. Type a value.</span> : <span className="muted">Select a white cell to type in it.</span>}</span>
      </div>
      <div className="gridwrap">
        <table ref={gridRef} className="sheet">
          <thead>
            {lettered ? null : (
              <tr aria-hidden="true">
                <th className="rh" aria-hidden="true" />
                {config.columns.map((_, i) => (
                  <th key={i} aria-hidden="true">
                    {colLetter(i)}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              <th className="rh" aria-hidden="true" />
              {config.columns.map((label, i) => (
                <th key={i} scope="col" style={lettered ? undefined : { textAlign: "left", fontSize: 12, color: "var(--ink-2)" }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, r) => {
              const span = sectionSpan(row);
              return (
                <tr key={r}>
                  <th scope="row">{r + 1}</th>
                  {span ? (
                    <td className="ro lbl" colSpan={span}>
                      {(row[0] as Extract<PublicCell, { kind: "text" }>).text}
                    </td>
                  ) : (
                    row.map((cell, c) => {
                      if (cell?.kind === "input") {
                        const ref = `${colLetter(c)}${r + 1}`;
                        return (
                          <td key={c} className="ed">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`${row[0]?.kind === "text" ? row[0].text : `Row ${r + 1}`}, ${config.columns[c] ?? `column ${c + 1}`}`}
                              data-cell={`${r}:${c}`}
                              disabled={disabled}
                              value={text[cell.id] ?? ""}
                              onFocus={() => setFocus({ ref, id: cell.id })}
                              onChange={(e) => update(cell.id, e.target.value)}
                              onKeyDown={(e) => move(e, r, c)}
                              className="cell num"
                              style={{ minWidth: 120 }}
                            />
                          </td>
                        );
                      }
                      if (cell?.kind === "text") {
                        const cls = ["ro", cell.align === "right" ? "num" : "", cell.bold ? "lbl" : ""].filter(Boolean).join(" ");
                        return (
                          <td key={c} className={cls}>
                            {cell.text}
                          </td>
                        );
                      }
                      return <td key={c} className="ro" />;
                    })
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span className="row g6">
          <span className="sw" style={{ background: "var(--subtle)" }} />
          Read-only
        </span>
        <span className="row g6">
          <span className="sw" style={{ background: "#fff", boxShadow: "inset 0 -2px 0 var(--accent-line)" }} />
          You fill in
        </span>
        <span className="grow" />
        <span>Negatives as -100 or (100) · ↑ ↓ or Enter move · Tab next cell</span>
      </div>
    </div>
  );
}
