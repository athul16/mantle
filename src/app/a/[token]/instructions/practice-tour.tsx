"use client";

import { useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";

/**
 * The practice run (prototype vInstructions()): a small,
 * untimed copy of the workspace with coach marks. Entirely in the browser:
 * nothing typed here is saved, sent or scored.
 */

const COACH: Record<number, { t: string; d: (m: number) => string; pos: CSSProperties }> = {
  1: {
    t: "Your clock",
    d: (m) => `Counts down from ${m}:00 once you start.`,
    pos: { top: 58, left: 12 },
  },
  2: {
    t: "Your inbox",
    d: () => "Tasks arrive here as emails, some while you work.",
    pos: { top: 96, left: 214 },
  },
  3: {
    t: "The workbook",
    d: () => "Grey cells are read-only. White cells are yours. Try typing 1,250 in B2.",
    pos: { top: 228, right: 24 },
  },
  4: {
    t: "Reply and send",
    d: () => "Some tasks need a reply. Try sending “Done”.",
    pos: { bottom: 70, right: 24 },
  },
};

const STEPS: [number, string, string][] = [
  [1, "Clock", "Top left"],
  [2, "Inbox", "Where tasks arrive"],
  [3, "Workbook", "White cells are yours"],
  [4, "Reply", "Send your answer"],
];

function parseNum(v: string): number | null {
  const s = v.replace(/[,\s$]/g, "");
  if (!s) return null;
  const n = Number(s.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : null;
}
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PracticeTour({ minutes, title }: { minutes: number; title: string }) {
  const [step, setStep] = useState<number>(1);
  const [cell, setCell] = useState("");
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const n = parseNum(cell);
  const coach = step ? COACH[step] : null;
  const spot = (k: number) => (step === k ? "spot " : "");

  return (
    <>
      <div className="pframe">
        <div className="pf-head">
          <span className={`${spot(1)}pf-clock`}>
            <Icon name="clock" className="i-sm" />
            Practice
          </span>
          <span className="small strong">{title}</span>
          <span className="grow" />
          <span className="xs okc">Saved</span>
        </div>
        <div className="pf-body">
          <div className="pf-inbox">
            <span className="xs strong muted">Inbox</span>
            <div className={spot(2)} style={{ padding: "8px 10px", borderRadius: 7, background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
              <div className="xs strong">Practice message</div>
              <div className="xs muted">Fill in one cell, then reply</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="wtabs" style={{ paddingTop: 6 }}>
              <span className="wtab ro">
                <Icon name="lock" className="i-sm" />
                Source data
              </span>
              <span className="wtab on">Your workbook</span>
            </div>
            <div className={step === 3 ? "spot" : undefined} style={{ margin: 0 }}>
              <table className="sheet" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th className="rh" />
                    <th>A</th>
                    <th>B</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>1</th>
                    <td className="ro">Opening balance</td>
                    <td className="ro" style={{ textAlign: "right" }}>
                      5,000.00
                    </td>
                  </tr>
                  <tr>
                    <th>2</th>
                    <td className="ro">Deposit</td>
                    <td className="ed">
                      <input className="cell num" value={cell} onChange={(e) => setCell(e.currentTarget.value)} placeholder="Type here" aria-label="B2 Deposit" />
                    </td>
                  </tr>
                  <tr>
                    <th>3</th>
                    <td className="ro">Closing balance</td>
                    <td className="ro" style={{ textAlign: "right", color: "var(--ink-3)" }}>
                      {n != null ? fmt(5000 + n) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span className="grow" />
            <div className={`${spot(4)}row g8`} style={{ borderTop: "1px solid var(--line)", padding: "8px 10px" }}>
              {sent ? (
                <span className="small okc row g6" style={{ height: 30 }}>
                  <Icon name="check" className="i-sm" />
                  Sent “{sent}”
                </span>
              ) : (
                <>
                  <input
                    className="input"
                    style={{ height: 30, fontSize: 12 }}
                    value={reply}
                    onChange={(e) => setReply(e.currentTarget.value)}
                    placeholder="Reply…"
                    aria-label="Practice reply"
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => reply.trim() && setSent(reply.trim())}>
                    Send
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        {coach ? (
          <div className="coach" role="dialog" aria-label={`Practice step ${step} of 4`} style={coach.pos}>
            <span className="xs muted">Step {step} of 4</span>
            <span className="strong">{coach.t}</span>
            <span className="small ink2">{coach.d(minutes)}</span>
            {step === 3 ? (
              <span className="xs">
                {n === 1250 ? (
                  <span className="okc row g4">
                    <Icon name="check" className="i-sm" />
                    That&apos;s it.
                  </span>
                ) : (
                  <span className="muted">Type 1,250 in B2</span>
                )}
              </span>
            ) : null}
            <div className="row g8" style={{ justifyContent: "flex-end" }}>
              {step > 1 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>
                  Skip tour
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep(step === 4 ? 0 : step + 1)}>
                {step === 4 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: 10 }}>
        {STEPS.map(([k, t, d]) => (
          <li key={k}>
            <button type="button" className={`card cardbtn tourstep${step === k ? " on" : ""}`} style={{ width: "100%" }} onClick={() => setStep(k)} aria-pressed={step === k}>
              <span className="step-n" style={step === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
                {k}
              </span>
              <span className="small">
                <span className="strong">{t}</span>
                <span className="muted" style={{ display: "block" }}>
                  {d}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}
