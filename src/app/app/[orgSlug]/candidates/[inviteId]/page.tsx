import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { applyWaivers, describeAccommodations, hasAccommodations, type Accommodations } from "@/lib/accommodations";
import { requireOrgMembership, requireUser } from "@/lib/auth";
import { getInviteAccommodations } from "@/lib/jobs/queries";
import type { StepDetail } from "@/lib/results/answer-key";
import { flagCounts, getFlagsForReport, getInviteProctoring, type FlagsReport } from "@/lib/proctoring/report";
import { getCandidateReport, type CandidateReport } from "@/lib/results/queries";
import { VOTE_LABELS } from "@/lib/results/schemas";
import { formatDuration, scorePercent } from "@/lib/results/summary";
import { createClient } from "@/lib/supabase/server";
import { LocalDate } from "../../jobs/local-date";
import { StatusBadge } from "../status-badge";
import { DeleteCandidateData } from "./delete-candidate";
import { FlagsSection } from "./flags-section";
import { AddNoteForm, DeleteNoteButton, RubricReviewForm } from "./report-forms";

export const metadata = { title: "Candidate report · Assessment Platform" };

const muted = "text-neutral-600 dark:text-neutral-400";

// Candidate report (docs/05): summary, per-task answer vs expected, rubric
// review for steps that need a person, integrity flags with evidence (step 7),
// attempt timeline, notes and votes.
// Answer keys appear here because this page is for org members only.
export default async function CandidateReportPage({ params }: PageProps<"/app/[orgSlug]/candidates/[inviteId]">) {
  const { orgSlug, inviteId } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const user = await requireUser();
  if (!z.uuid().safeParse(inviteId).success) notFound();
  const report = await getCandidateReport(orgId, inviteId);
  if (!report) notFound();

  const { attempt } = report;
  const canReview = role === "admin" || role === "recruiter";
  const score = attempt?.score ?? null;
  const db = await createClient();
  const [flags, assessmentProctoring, accommodations] = await Promise.all([
    attempt ? getFlagsForReport(db, orgId, attempt.id) : Promise.resolve<FlagsReport>({ flags: [], canSeeMedia: false }),
    getInviteProctoring(db, orgId, inviteId),
    getInviteAccommodations(orgId, inviteId),
  ]);
  // What this candidate was actually monitored with (D9 waivers apply per invite).
  const proctoring = applyWaivers(assessmentProctoring, accommodations);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href={`/app/${orgSlug}/candidates?job=${report.job.id}`} className={`text-sm hover:underline ${muted}`}>
          ← {report.job.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{report.candidateName?.trim() || report.email}</h1>
        <p className={`flex flex-wrap items-center gap-2 text-sm ${muted}`}>
          {report.candidateName ? <span>{report.email}</span> : null}
          <StatusBadge status={report.status} needsReview={(attempt?.needsReview.length ?? 0) > 0} />
          {report.assessment ? <span>{report.assessment.title}</span> : null}
          {canReview ? null : <span>· read-only</span>}
        </p>
      </div>

      <Summary
        report={report}
        flags={attempt && attempt.status !== "not_started" ? flags : null}
        accommodations={accommodations}
      />

      {report.steps.length ? (
        <section className="space-y-4" aria-labelledby="tasks-heading">
          <h2 id="tasks-heading" className="text-lg font-medium">Tasks</h2>
          {report.steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              orgId={orgId}
              attemptId={attempt!.id}
              canReview={canReview && score !== null}
            />
          ))}
        </section>
      ) : null}

      {attempt && attempt.status !== "not_started" ? (
        <FlagsSection
          orgId={orgId}
          startedAt={attempt.startedAt}
          flags={flags.flags}
          canReview={canReview}
          canSeeMedia={flags.canSeeMedia}
          monitored={proctoring.camera || proctoring.screen}
        />
      ) : null}

      {report.timeline.length ? (
        <section className="space-y-2" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="text-lg font-medium">Timeline</h2>
          <ol className="space-y-1 text-sm">
            {report.timeline.map((t, n) => (
              <li key={`${t.at}-${n}`} className="flex gap-3">
                <span className={`w-16 shrink-0 text-right tabular-nums ${muted}`}>{t.offset}</span>
                <span>{t.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {attempt ? (
        <section className="space-y-3" aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="text-lg font-medium">Notes and votes ({report.notes.length})</h2>
          {report.notes.length === 0 ? <p className={`text-sm ${muted}`}>No notes yet.</p> : null}
          <ul className="space-y-2">
            {report.notes.map((n) => (
              <li key={n.id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className={`flex flex-wrap items-center gap-2 text-xs ${muted}`}>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{n.authorEmail}</span>
                  <LocalDate iso={n.createdAt} withTime />
                  {n.vote ? <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">{VOTE_LABELS[n.vote]}</span> : null}
                  {n.authorId === user.id ? <DeleteNoteButton orgId={orgId} noteId={n.id} /> : null}
                </div>
                {n.body ? <p className="mt-1 whitespace-pre-wrap">{n.body}</p> : null}
              </li>
            ))}
          </ul>
          <AddNoteForm orgId={orgId} attemptId={attempt.id} />
        </section>
      ) : null}

      <DeleteCandidateData role={role} orgId={orgId} orgSlug={orgSlug} inviteId={inviteId} jobId={report.job.id} />
    </div>
  );
}

function Summary({
  report,
  flags,
  accommodations,
}: {
  report: CandidateReport;
  flags: FlagsReport | null;
  accommodations: Accommodations;
}) {
  const { attempt } = report;
  const score = attempt?.score ?? null;
  const pass = report.assessment?.passScore ?? null;
  const percent = score ? scorePercent(score.points, score.maxPoints) : null;

  let state: string;
  if (!attempt || attempt.status === "not_started") state = "Not started yet.";
  else if (attempt.status === "in_progress") state = "In progress.";
  else if (!score) state = "Submitted; scoring is still running.";
  else if (attempt.needsReview.length) state = `${attempt.needsReview.length} task${attempt.needsReview.length > 1 ? "s" : ""} need${attempt.needsReview.length > 1 ? "" : "s"} review; the score may go up.`;
  else state = "Scored.";

  const counts = flags ? flagCounts(flags.flags) : null;
  const countDetail = counts
    ? [counts.open ? `${counts.open} open` : "", counts.reviewed ? `${counts.reviewed} reviewed` : ""].filter(Boolean).join(" · ") || "none"
    : "";

  return (
    <section aria-labelledby="summary-heading" className="space-y-3">
      <h2 id="summary-heading" className="sr-only">Summary</h2>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 p-4 sm:grid-cols-5 dark:border-neutral-800">
        <div>
          <dt className={`text-xs uppercase ${muted}`}>Final score</dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="final-score">
            {score ? `${percent}%` : "—"}
          </dd>
          {score ? (
            <dd className={`text-xs tabular-nums ${muted}`}>
              {score.points} / {score.maxPoints} points
              {pass !== null ? ` · pass ${pass}%` : ""}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className={`text-xs uppercase ${muted}`}>Time taken</dt>
          <dd className="text-2xl font-semibold tabular-nums">{formatDuration(attempt?.timeTakenSeconds ?? null)}</dd>
          {attempt?.submitReason === "timeout" ? <dd className={`text-xs ${muted}`}>time ran out</dd> : null}
        </div>
        <div>
          <dt className={`text-xs uppercase ${muted}`}>Started</dt>
          <dd className="text-sm"><LocalDate iso={attempt?.startedAt ?? null} withTime /></dd>
        </div>
        <div>
          <dt className={`text-xs uppercase ${muted}`}>Submitted</dt>
          <dd className="text-sm"><LocalDate iso={attempt?.submittedAt ?? null} withTime /></dd>
        </div>
        <div>
          <dt className={`text-xs uppercase ${muted}`}>Integrity flags</dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="flag-count">{counts ? counts.total : "—"}</dd>
          {counts ? <dd className={`text-xs ${muted}`} data-testid="flag-count-detail">{countDetail}</dd> : null}
        </div>
      </dl>
      <p className="text-sm" role="status">{state}</p>
      {hasAccommodations(accommodations) ? (
        <p className="text-sm" data-testid="report-accommodations">
          <span className="font-medium">Accommodations:</span>{" "}
          {describeAccommodations(accommodations, report.assessment?.timeLimitMinutes).join(", ")}. Set by the hiring team before
          the candidate started; logged in the audit log.
        </p>
      ) : null}
    </section>
  );
}

function StepCard({ step, orgId, attemptId, canReview }: { step: StepDetail; orgId: string; attemptId: string; canReview: boolean }) {
  const s = step.score;
  const reviewable = !!s && (s.needsReview === true || !!s.review);
  const hasAnswerColumn = step.rows.some((r) => r.answer !== "");

  return (
    <article className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-labelledby={`step-${step.id}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`step-${step.id}`} className="font-medium">{step.title}</h3>
        <span className="text-sm tabular-nums">
          {s ? `${s.points} / ${s.maxPoints}` : "—"}
          {s?.needsReview ? (
            <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-900 dark:bg-purple-950 dark:text-purple-200">needs review</span>
          ) : null}
          {s?.review ? (
            <span className={`ml-2 text-xs ${muted}`}>
              reviewed <LocalDate iso={s.review.at} />
            </span>
          ) : null}
        </span>
      </header>

      {step.answerText !== null ? (
        <div className="space-y-1">
          <p className={`text-xs uppercase ${muted}`}>Candidate&apos;s answer</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 font-sans text-sm dark:bg-neutral-900">{step.answerText}</pre>
        </div>
      ) : step.type === "inbox_reply" ? (
        <p className={`text-sm ${muted}`}>No reply written.</p>
      ) : null}

      {step.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={`text-xs uppercase ${muted}`}>
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">{step.type === "inbox_reply" ? "Criterion" : "Item"}</th>
                {hasAnswerColumn ? <th scope="col" className="py-1 pr-4 text-right font-medium">Answer</th> : null}
                <th scope="col" className={`py-1 pr-4 font-medium ${hasAnswerColumn ? "text-right" : ""}`}>
                  {step.type === "inbox_reply" ? "What to look for" : "Expected"}
                </th>
                <th scope="col" className="py-1 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
              {step.rows.map((r) => {
                const wrong = r.earned !== undefined && r.max !== undefined && r.earned < r.max;
                return (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-4 align-top">
                      {r.label}
                      {r.note && step.type !== "inbox_reply" ? <span className={`block text-xs ${muted}`}>{r.note}</span> : null}
                    </td>
                    {hasAnswerColumn ? (
                      <td className={`py-1.5 pr-4 text-right align-top tabular-nums ${wrong ? "text-red-700 dark:text-red-400" : ""}`}>{r.answer}</td>
                    ) : null}
                    <td className={`py-1.5 pr-4 align-top ${hasAnswerColumn ? "text-right tabular-nums" : ""}`}>{r.expected}</td>
                    <td className="py-1.5 text-right align-top tabular-nums">
                      {r.earned !== undefined ? `${r.earned} / ${r.max}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {reviewable && canReview ? (
        <RubricReviewForm
          orgId={orgId}
          attemptId={attemptId}
          stepId={step.id}
          stepTitle={step.title}
          reviewed={!!s?.review}
          criteria={(s?.items ?? []).map((i) => ({ id: i.id, label: i.label, max: i.max, earned: i.earned }))}
        />
      ) : reviewable && s?.needsReview ? (
        <p className={`text-sm ${muted}`}>Waiting for a recruiter or admin to score this task.</p>
      ) : null}
    </article>
  );
}
