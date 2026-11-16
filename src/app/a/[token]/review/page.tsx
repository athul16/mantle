import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { getReview, getWorkspaceView } from "@/lib/candidate/attempt";
import { pageForStatus, requireSessionPage } from "@/lib/candidate/pages";
import { hasAnswer, stepKindLabel } from "../workspace/labels";
import { LiveTimer } from "../workspace/parts";
import { ReviewSubmit } from "./review-form";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Review before you submit" };

/** Review and submit (prototype "review B"): every task that has arrived, whether it has an answer, and the final submit. */
export default async function ReviewPage({ params }: PageProps<"/a/[token]/review">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["in_progress"]);
  const view = await getWorkspaceView(session);
  if (!view) redirect(pageForStatus(token, attempt));
  // With timed sections, list every task of the sections reached; finished ones can't be reopened.
  const review = view.flow ? await getReview(session) : null;
  const rows = review
    ? review.map((r, i) => ({ step: { id: r.stepId, title: r.title, type: r.type }, n: i + 1, answered: r.answered, open: r.open }))
    : view.steps.map((s, i) => ({ step: s, n: i + 1, answered: hasAnswer(view.answers[s.id]), open: true }));
  const open = rows.filter((r) => !r.answered).length;
  const company = session.invite.companyName;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header className="rv-head">
        <LiveTimer deadlineAt={view.deadlineAt} serverNow={view.serverNow} />
        <span className="strong">{view.title}</span>
        <span className="grow" />
        <Link href={`/a/${token}/workspace`} className="btn">
          <Icon name="chevL" />
          Back to workspace
        </Link>
      </header>
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px 120px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div className="col g6">
          <h1 style={{ fontSize: 28 }}>Review before you submit</h1>
          <p className="ink2">
            The clock is still running, and more messages may arrive before time runs out.{" "}
            {open ? `${open === 1 ? "One task looks" : `${open} tasks look`} unfinished. Fix anything you want, or submit now.` : "Every task has an answer."}
          </p>
        </div>
        <section className="card" style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ fontSize: 14 }}>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>
                  <span className="sr">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ step, n, answered, open }) => (
                <tr key={step.id}>
                  <td>
                    <span className="strong">
                      {n} · {step.title}
                    </span>
                    <span className="xs muted" style={{ display: "block" }}>
                      {stepKindLabel(step.type)}
                    </span>
                  </td>
                  <td>
                    {answered ? (
                      <span className="badge b-ok">
                        <Icon name="check" />
                        Answered
                      </span>
                    ) : (
                      <span className="badge">
                        <Icon name="circle" />
                        Not started
                      </span>
                    )}
                  </td>
                  <td className="r">
                    {open ? (
                      <Link
                        href={`/a/${token}/workspace?task=${encodeURIComponent(step.id)}`}
                        className={answered ? "btn btn-sm btn-ghost" : "btn btn-sm"}
                        aria-label={`${answered ? "Open" : "Start"} ${step.title}`}
                      >
                        {answered ? "Open" : "Start"}
                      </Link>
                    ) : (
                      <span className="xs muted">Section closed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section style={{ padding: "20px 22px", borderRadius: 12, background: "#fff", border: "1px solid var(--line-2)", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="row g12" style={{ alignItems: "flex-start" }}>
            <span className="ovicon" style={{ width: 36, height: 36, borderRadius: 9, background: "var(--subtle)", flex: "none" }}>
              <Icon name="lock" />
            </span>
            <div>
              <div className="strong">Submitting is final</div>
              <p className="small ink2">
                You won&apos;t be able to reopen any task. Drafts are submitted as they are, and {company} sees exactly what&apos;s saved.
              </p>
            </div>
          </div>
          <ReviewSubmit token={token} />
        </section>
      </main>
    </div>
  );
}
