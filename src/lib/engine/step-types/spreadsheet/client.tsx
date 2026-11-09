"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { StepComponentProps } from "../../types";
import { parseCellInput, type SpreadsheetAnswer, type SpreadsheetPublicConfig } from "./public";

/**
 * Browser half of the `spreadsheet` step type: a plain grid. Read-only cells
 * are text; input cells take numbers. Enter / arrow up / arrow down move
 * between input cells in the same column. No formulas: only values are scored.
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
  const gridRef = useRef<HTMLTableElement>(null);

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

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 whitespace-pre-line">{config.prompt}</p>
      <div className="overflow-x-auto">
        <table ref={gridRef} className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {config.columns.map((label, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border border-neutral-300 bg-neutral-100 px-2 py-1 text-left font-medium dark:border-neutral-700 dark:bg-neutral-800"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  const base = "border border-neutral-300 dark:border-neutral-700";
                  if (cell.kind === "input") {
                    return (
                      <td key={c} className={`${base} p-0`}>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`${row[0]?.kind === "text" ? row[0].text : `Row ${r + 1}`}, ${config.columns[c] ?? `column ${c + 1}`}`}
                          data-cell={`${r}:${c}`}
                          disabled={disabled}
                          value={text[cell.id] ?? ""}
                          placeholder={cell.format === "money" ? "0.00" : "0"}
                          onChange={(e) => update(cell.id, e.target.value)}
                          onKeyDown={(e) => move(e, r, c)}
                          className="w-full min-w-28 bg-yellow-50 px-2 py-1 text-right font-mono outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset dark:bg-yellow-950/30"
                        />
                      </td>
                    );
                  }
                  if (cell.kind === "text") {
                    const numeric = cell.align === "right";
                    return (
                      <td
                        key={c}
                        className={`${base} px-2 py-1 ${numeric ? "text-right font-mono" : ""} ${cell.bold ? "font-semibold" : ""}`}
                      >
                        {cell.text}
                      </td>
                    );
                  }
                  return <td key={c} className={base} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Yellow cells are yours to fill in. Enter numbers only; negatives as -100 or (100).
      </p>
    </div>
  );
}
