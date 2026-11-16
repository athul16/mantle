import type { StepRow } from "@/lib/results/answer-key";
import { ResultBadge } from "./report-ui";

const NOT_ANSWERED = "(not answered)";

/**
 * A task's rows on the candidate report: the candidate's answer next to the
 * expected one and the result. Rapid items add their prompt under the label
 * and a Time column with the server-measured response time.
 */
export function AnswerTable({ rows, first }: { rows: StepRow[]; first: string }) {
  const hasAnswerColumn = rows.some((r) => r.answer !== "");
  const hasTime = rows.some((r) => r.responseMs !== undefined);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th>
            {hasAnswerColumn ? <th className="r">{first}</th> : null}
            <th className={hasAnswerColumn ? "r" : undefined}>Expected</th>
            {hasTime ? <th className="r" style={{ width: 80 }}>Time</th> : null}
            <th style={{ width: 140 }}>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const scored = r.earned !== undefined && r.max !== undefined;
            return (
              <tr key={r.id}>
                <td>
                  {r.label}
                  {r.prompt ? <div className="xs ink2">{r.prompt}</div> : null}
                  {r.note && !(scored && r.earned! >= r.max!) ? <div className="xs muted">{r.note}</div> : null}
                </td>
                {hasAnswerColumn ? <td className="r tnum">{r.answer === NOT_ANSWERED ? <span className="muted">—</span> : r.answer}</td> : null}
                <td className={hasAnswerColumn ? "r tnum muted" : "muted"}>{r.expected}</td>
                {hasTime ? (
                  <td className="r tnum">
                    {r.responseMs !== undefined ? `${(r.responseMs / 1000).toFixed(1)} s` : scored ? <span className="muted">—</span> : null}
                  </td>
                ) : null}
                <td>{scored ? <ResultBadge earned={r.earned!} max={r.max!} answered={r.answer !== NOT_ANSWERED && r.answer !== ""} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
