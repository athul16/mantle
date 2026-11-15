"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

/**
 * Evaluates "+ − × ÷" left to right with the usual precedence. Only numbers
 * and the four operators are read, so nothing typed can run as code.
 */
export function evaluate(expr: string): number {
  const tokens = expr.match(/\d+(?:\.\d+)?|\.\d+|[+\-*/]/g);
  if (!tokens) return 0;
  const seq: (number | string)[] = [];
  let expectNumber = true;
  let sign = 1;
  for (const t of tokens) {
    if (expectNumber) {
      if (t === "-") {
        sign = -sign;
        continue;
      }
      if (/[+*/]/.test(t)) continue;
      seq.push(sign * parseFloat(t));
      sign = 1;
      expectNumber = false;
    } else {
      seq.push(t);
      expectNumber = true;
    }
  }
  if (typeof seq[seq.length - 1] === "string") seq.pop();
  if (!seq.length) return 0;
  const stack: (number | string)[] = [seq[0]];
  for (let i = 1; i < seq.length; i += 2) {
    const op = seq[i] as string;
    const n = seq[i + 1] as number;
    const last = stack.length - 1;
    if (op === "*") stack[last] = (stack[last] as number) * n;
    else if (op === "/") stack[last] = (stack[last] as number) / n;
    else stack.push(op, n);
  }
  let v = stack[0] as number;
  for (let i = 1; i < stack.length; i += 2) v = stack[i] === "+" ? v + (stack[i + 1] as number) : v - (stack[i + 1] as number);
  return v;
}

const pretty = (e: string) => e.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");

const KEYS: [string, string][] = [
  ["C", "C"], ["back", "⌫"], ["/", "÷"], ["*", "×"],
  ["7", "7"], ["8", "8"], ["9", "9"], ["-", "−"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["+", "+"],
  ["1", "1"], ["2", "2"], ["3", "3"], ["=", "="],
  ["0", "0"], ["00", "00"], [".", "."],
];

/** The built-in calculator: a small popover in the bottom-right of the workspace. Nothing it does is saved or sent. */
export function Calculator({ onClose }: { onClose(): void }) {
  const [expr, setExpr] = useState("");
  const [last, setLast] = useState("");
  const [out, setOut] = useState("0");

  const press = (k: string) => {
    if (k === "C") {
      setExpr("");
      setLast("");
      setOut("0");
    } else if (k === "back") {
      const next = expr.slice(0, -1);
      setExpr(next);
      setOut(pretty(next) || "0");
    } else if (k === "=") {
      const v = evaluate(expr);
      if (!Number.isFinite(v)) {
        setOut("Error");
        setExpr("");
        return;
      }
      const rounded = Math.round(v * 100) / 100;
      setLast(`${pretty(expr)} =`);
      setOut(rounded.toLocaleString("en-US", { maximumFractionDigits: 2 }));
      setExpr(String(rounded));
    } else {
      const next = expr + k;
      setExpr(next);
      setOut(pretty(next));
    }
  };

  return (
    <div className="calc" role="group" aria-label="Calculator">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small strong">Calculator</span>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-icon" style={{ width: 26, height: 26 }} onClick={onClose} aria-label="Close calculator">
          <Icon name="x" className="i-sm" />
        </button>
      </div>
      <div className="calc-disp" aria-live="polite">
        <span className="xs muted">{last}</span>
        <span style={{ fontSize: 17, fontWeight: 600 }} data-testid="calc-output">
          {out}
        </span>
      </div>
      <div className="calc-keys">
        {KEYS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={k === "=" ? "btn btn-sm btn-primary" : "btn btn-sm"}
            style={k === "=" ? { gridRow: "span 2", height: "auto" } : undefined}
            onClick={() => press(k)}
            aria-label={k === "back" ? "Delete" : label}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
