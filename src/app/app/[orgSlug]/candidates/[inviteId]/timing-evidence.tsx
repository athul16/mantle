import type { ReactNode } from "react";
import type { TimingReport } from "@/lib/results/timing";
import { CardTitle } from "./report-ui";

/** Time since the attempt started, as m:ss or h:mm:ss. */
function offset(startedAt: string | null, at: string): string {
  if (!startedAt) return "";
  const total = Math.max(0, Math.round((Date.parse(at) - Date.parse(startedAt)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const pct = (n: number) => String(Math.round(n * 10) / 10);

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
      <span id={id} className="small strong">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The Timing card on the candidate report, shown when the assessment has a
 * rapid round (docs/06). Evidence only, in neutral words: it never sets or
 * shows an integrity label, and nothing here changes a score.
 */
export function TimingEvidence({ startedAt, timing }: { startedAt: string | null; timing: TimingReport | null }) {
  if (!timing) return null;
  const quick = timing.quickAfterReturn;
  const gap = timing.rapidGap?.large ? timing.rapidGap : null;
  return (
    <section aria-labelledby="timing-heading" className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <CardTitle id="timing-heading">Timing</CardTitle>
      <p className="xs muted">For context only. These rows don&apos;t change the integrity label or the score.</p>

      <Row id="timing-quick" label="Answered within 2 s of returning to the window">
        <span className="small ink2">{quick.length ? `${quick.length} answer${quick.length === 1 ? "" : "s"}` : "None"}</span>
        {quick.length ? (
          <ul className="xs ink2" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
            {quick.map((q) => {
              const when = offset(startedAt, q.answeredAt);
              return (
                <li key={`${q.stepId}-${q.index}`}>
                  {`${q.stepTitle}, item ${q.index + 1}: answered ${(q.afterMs / 1000).toFixed(1)} s after returning${
                    q.awayMs !== null ? ` (away ${Math.round(q.awayMs / 1000)} s)` : ""
                  }${when ? ` · ${when} into the test` : ""}`}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Row>

      {gap ? (
        <Row id="timing-gap" label="Rapid round vs other tasks">
          <span className="small ink2 tnum">{`Rapid round ${pct(gap.rapidPercent)}% · other tasks ${pct(gap.otherPercent)}%`}</span>
          <span className="xs muted tnum">{`${pct(Math.abs(gap.gap))} points apart`}</span>
          <span className="xs muted">Many things can explain a gap like this; read it alongside the answers.</span>
        </Row>
      ) : null}
    </section>
  );
}
