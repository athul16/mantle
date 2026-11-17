import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import * as z from "zod";
import { Avatar } from "@/components/brand";
import { applyWaivers, describeAccommodations, hasAccommodations, type Accommodations } from "@/lib/accommodations";
import { Icon } from "@/components/icons";
import { requireOrgMembership, requireUser } from "@/lib/auth";
import { getInviteAccommodations } from "@/lib/jobs/queries";
import { getFlagsForReport, getInviteProctoring, type FlagsReport, type ReportFlag } from "@/lib/proctoring/report";
import { getCandidateReport, listJobResults, type CandidateReport, type ReportNote } from "@/lib/results/queries";
import { VOTE_LABELS } from "@/lib/results/schemas";
import { scorePercent } from "@/lib/results/summary";
import { createClient } from "@/lib/supabase/server";
import { DeleteCandidateData } from "./delete-candidate";
import { FlagsSection } from "./flags-section";
import { getSignalCounts } from "./integrity";
import { AddNoteForm, CriterionCell, CriterionPoints, DeleteNoteButton, RubricReviewForm, VoteButtons, type RubricCriterionInput } from "./report-forms";
import { ReportTime } from "./report-time";
import { percentiles } from "@/lib/results/candidate-table";
import { CardTitle, ordinal, PointsBadge } from "./report-ui";
import { AnswerTable } from "./answer-table";
import { TimingEvidence } from "./timing-evidence";

export const metadata = { title: "Candidate report · Mantle" };

// Candidate report (docs/05), laid out as the prototype's report: a sub-header
// with the breadcrumb and a by-score pager; on the left the candidate, the
// Integrity card (signals, flags with evidence and review, docs/02), team
// votes and notes, and the admin-only delete; on the right the overall score
// against the rest of the job, each task's answer next to the expected one,
// rubric review for steps that need a person, and the timeline.
// Answer keys appear here because this page is for org members only.
export default async function CandidateReportPage({ params }: PageProps<"/app/[orgSlug]/candidates/[inviteId]">) {
  const { orgSlug, inviteId } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const user = await requireUser();
  if (!z.uuid().safeParse(inviteId).success) notFound();
  const report = await getCandidateReport(orgId, inviteId);
  if (!report) notFound();

  const { attempt } = report;
  const name = report.candidateName?.trim() || report.email;
  const listHref = `/app/${orgSlug}/candidates?job=${report.job.id}`;
  const deleteCard = (
    <DeleteCandidateData role={role} orgId={orgId} orgSlug={orgSlug} inviteId={inviteId} jobId={report.job.id} candidate={name} />
  );

  // Not submitted yet: there's nothing to report, as in the prototype.
  if (!attempt || attempt.status === "not_started" || attempt.status === "in_progress") {
    const msg = waitingMessage(report, name);
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px 120px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card raised" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="eyebrow">{report.job.title}</span>
          <h1 style={{ fontSize: 24 }}>{msg[0]}</h1>
          <p className="ink2">{msg[1]}</p>
          <p className="small muted">{report.email}</p>
          <div className="row g10 wrap">
            <Link className="btn btn-primary" href={listHref}>
              Back to candidates
            </Link>
          </div>
        </div>
        {deleteCard}
      </main>
    );
  }

  const canReview = role === "admin" || role === "recruiter";
  const score = attempt.score;
  const db = await createClient();
  const [flags, assessmentProctoring, counts, jobRows, accommodations] = await Promise.all([
    getFlagsForReport(db, orgId, attempt.id),
    getInviteProctoring(db, orgId, inviteId),
    getSignalCounts(db, orgId, attempt.id),
    listJobResults(orgId, report.job.id),
    getInviteAccommodations(orgId, inviteId),
  ]);
  // What this candidate was actually monitored with (D9 waivers apply per invite).
  const proctoring = applyWaivers(assessmentProctoring, accommodations);

  // Rank by score within the job: the pager walks candidates best first, then the unscored.
  const ranked = [...jobRows.filter((r) => r.percent !== null).sort((a, b) => b.percent! - a.percent!), ...jobRows.filter((r) => r.percent === null)];
  const pos = ranked.findIndex((r) => r.inviteId === inviteId);
  const prev = pos > 0 ? ranked[pos - 1] : null;
  const next = pos >= 0 && pos < ranked.length - 1 ? ranked[pos + 1] : null;
  const scored = jobRows.filter((r) => r.percent !== null).map((r) => ({ id: r.inviteId, percent: r.percent! }));

  const first = report.candidateName?.trim() ? report.candidateName.trim().split(/\s+/)[0] : "Candidate";
  const myVote = latestVotes(report.notes).find((v) => v.authorId === user.id)?.vote ?? null;

  return (
    <div>
      <div style={{ background: "#fff", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 1360, margin: "0 auto", padding: "12px 32px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 61 }}>
          <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <Link href={`/app/${orgSlug}/jobs`}>Jobs</Link>
            <Icon name="chevR" className="i-sm muted" />
            <Link href={listHref}>{report.job.title}</Link>
            <Icon name="chevR" className="i-sm muted" />
            <span className="strong" aria-current="page">{name}</span>
          </nav>
          <span style={{ flex: 1 }} />
          {canReview ? null : <span className="badge">Read-only</span>}
          {ranked.length > 1 && pos >= 0 ? (
            <>
              <PagerLink href={prev ? `/app/${orgSlug}/candidates/${prev.inviteId}` : null} label="Previous candidate" icon="chevL" />
              <span className="small muted tnum">
                {pos + 1} / {ranked.length}
              </span>
              <PagerLink href={next ? `/app/${orgSlug}/candidates/${next.inviteId}` : null} label="Next candidate" icon="chevR" />
            </>
          ) : null}
        </div>
      </div>

      <div style={{ maxWidth: 1360, margin: "0 auto", padding: "24px 32px 120px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <aside aria-label="Candidate" style={{ flex: "1 1 340px", maxWidth: 360, display: "flex", flexDirection: "column", gap: 16 }}>
          <Identity report={report} name={name} score={score ? scorePercent(score.points, score.maxPoints) : null} accommodations={accommodations} />
          <FlagsSection
            orgId={orgId}
            startedAt={attempt.startedAt}
            flags={flags.flags}
            counts={counts}
            canReview={canReview}
            canSeeMedia={flags.canSeeMedia}
            camera={proctoring.camera}
            screen={proctoring.screen}
            gaze={proctoring.gaze}
            microphone={proctoring.microphone}
            fullscreen={proctoring.fullscreen}
          />
          <TimingEvidence startedAt={attempt.startedAt} timing={report.timing} />
          <TeamVotes orgId={orgId} attemptId={attempt.id} notes={report.notes} userId={user.id} myVote={myVote} />
          {deleteCard}
        </aside>

        <main style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <Overview report={report} flags={flags} scored={scored} first={first} />
          {report.steps.map((step, i) => (
            <StepSection key={step.id} n={i + 1} step={step} first={first} orgId={orgId} attemptId={attempt.id} canReview={canReview && score !== null} />
          ))}
          <Timeline report={report} flags={flags.flags} />
        </main>
      </div>
    </div>
  );
}

function waitingMessage(report: CandidateReport, name: string): [string, string] {
  switch (report.status) {
    case "started":
      return [`${name} is taking the assessment now`, "Their report appears here as soon as they submit."];
    case "expired":
      return [`${name}'s invite expired`, "They didn't start in time. Resend the link from the candidates list."];
    case "revoked":
      return [`${name}'s invite was revoked`, "Invite them again from the candidates list."];
    default:
      return [`${name} hasn't started yet`, "Their report appears here once they submit."];
  }
}

function PagerLink({ href, label, icon }: { href: string | null; label: string; icon: "chevL" | "chevR" }) {
  if (!href)
    return (
      <button type="button" className="btn btn-ghost btn-icon" aria-label={label} disabled>
        <Icon name={icon} />
      </button>
    );
  return (
    <Link className="btn btn-ghost btn-icon" aria-label={label} href={href}>
      <Icon name={icon} />
    </Link>
  );
}

/** m:ss, e.g. "25:09". */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Identity({ report, name, score, accommodations }: { report: CandidateReport; name: string; score: number | null; accommodations: Accommodations }) {
  const a = report.attempt!;
  const pass = report.assessment?.passScore ?? null;
  const limit = report.assessment ? report.assessment.timeLimitMinutes * 60 : null;
  const by = a.submitReason === "timeout" ? "Timer" : a.submitReason === "candidate" ? "Candidate" : a.submitReason ? a.submitReason : "—";
  const items: [string, ReactNode][] = [
    ["Invited", <ReportTime key="i" iso={report.invitedAt} format="day" />],
    ["Completed", <ReportTime key="c" iso={a.submittedAt} format="stamp" />],
    [
      "Time used",
      <span key="t" className="tnum">
        {a.timeTakenSeconds !== null ? clock(a.timeTakenSeconds) : "—"}
        {limit ? ` of ${clock(limit)}` : ""}
      </span>,
    ],
    ["Submitted by", by],
    ["Source", "Email invite"],
    [
      "Started · submitted",
      <span key="s" className="tnum">
        <ReportTime iso={a.startedAt} format="time" /> · <ReportTime iso={a.submittedAt} format="time" />
      </span>,
    ],
    [
      "Pass mark",
      pass === null ? (
        "None set"
      ) : (
        <span key="p">
          {pass}
          {score !== null ? (
            <>
              {" · "}
              {score >= pass ? <span style={{ color: "var(--ok)" }}>Meets bar</span> : <span style={{ color: "var(--warn)" }}>Below bar</span>}
            </>
          ) : null}
        </span>
      ),
    ],
  ];
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Avatar name={name} size={44} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 19, overflowWrap: "anywhere" }}>{name}</h1>
          <a className="small" href={`mailto:${report.email}`} style={{ overflowWrap: "anywhere" }}>
            {report.email}
          </a>
        </div>
      </div>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, fontSize: 13 }}>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="xs muted">{label}</dt>
            <dd className="strong" style={{ margin: 0 }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {hasAccommodations(accommodations) ? (
        <p className="small" style={{ padding: "10px 12px", borderRadius: 8, background: "var(--accent-soft)" }} data-testid="report-accommodations">
          <span className="strong">Accommodations:</span> {describeAccommodations(accommodations, report.assessment?.timeLimitMinutes).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

/** The newest vote per person (each vote is saved as a note). */
function latestVotes(notes: ReportNote[]): ReportNote[] {
  const byAuthor = new Map<string, ReportNote>();
  for (const n of [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (n.vote) byAuthor.set(n.authorId, n);
  return [...byAuthor.values()];
}

const VOTE_BADGE = {
  hire: { cls: "badge b-ok", icon: "up" },
  no_hire: { cls: "badge b-bad", icon: "down" },
  unsure: { cls: "badge", icon: "unsure" },
} as const;

function TeamVotes({ orgId, attemptId, notes, userId, myVote }: { orgId: string; attemptId: string; notes: ReportNote[]; userId: string; myVote: ReportNote["vote"] }) {
  const votes = latestVotes(notes);
  const written = notes.filter((n) => n.body);
  return (
    <section aria-labelledby="votes-heading" className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <CardTitle id="votes-heading">Team votes</CardTitle>
        <span style={{ flex: 1 }} />
        <span className="small muted">
          {votes.length} voted · {written.length} note{written.length === 1 ? "" : "s"}
        </span>
      </div>
      {votes.length ? (
        <ul aria-label="Votes" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          {votes.map((v) => {
            const b = VOTE_BADGE[v.vote!];
            return (
              <li key={v.authorId} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Avatar name={v.authorEmail} size={24} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.authorId === userId ? "You" : v.authorEmail}</span>
                <span className={b.cls} style={{ marginLeft: "auto" }}>
                  <Icon name={b.icon} />
                  {VOTE_LABELS[v.vote!]}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small muted">No votes yet.</p>
      )}
      <VoteButtons orgId={orgId} attemptId={attemptId} myVote={myVote} />
      {written.length ? (
        <>
          <div className="divider" />
          <ul aria-label="Notes" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {written.map((n) => (
              <li key={n.id} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span className="row g6 wrap">
                  <span className="strong">{n.authorEmail}</span>
                  <span className="xs muted">
                    · <ReportTime iso={n.createdAt} format="stamp" />
                  </span>
                  {n.vote ? <span className="xs muted">· {VOTE_LABELS[n.vote]}</span> : null}
                  {n.authorId === userId ? (
                    <span style={{ marginLeft: "auto" }}>
                      <DeleteNoteButton orgId={orgId} noteId={n.id} />
                    </span>
                  ) : null}
                </span>
                <p className="ink2 pre">{n.body}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <AddNoteForm orgId={orgId} attemptId={attemptId} />
    </section>
  );
}

function Overview({
  report,
  flags,
  scored,
  first,
}: {
  report: CandidateReport;
  flags: FlagsReport;
  scored: { id: string; percent: number }[];
  first: string;
}) {
  const a = report.attempt!;
  const score = a.score;
  // The automatic score is kept next to the final one (D11); shown once a reviewer changed it.
  const autoScore = a.autoScore ?? null;
  const percent = score ? scorePercent(score.points, score.maxPoints) : null;
  const others = scored.filter((s) => s.id !== report.inviteId);
  const below = percent === null ? 0 : others.filter((s) => s.percent < percent).length;
  // Same percentile as the candidates table (ties count half, clamped to 1–99).
  const pct = others.length ? (percentiles(scored.map((x) => ({ inviteId: x.id, percent: x.percent }))).get(report.inviteId) ?? null) : null;
  const higherThan = others.length ? Math.round((100 * below) / others.length) : 0;
  const review = a.needsReview.length;
  const openFlags = flags.flags.filter((f) => f.status === "open").length;

  return (
    <section aria-labelledby="score-heading" className="card" style={{ padding: "22px 24px", display: "flex", gap: 32, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 id="score-heading" className="eyebrow" style={{ fontFamily: "var(--font)", letterSpacing: ".04em", fontWeight: 600 }}>
          Overall score
        </h2>
        {percent !== null ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="display tnum" style={{ fontSize: 52, lineHeight: 1 }} data-testid="final-score">
                {percent}
              </span>
              <span className="muted">/ 100</span>
            </div>
            <span className="small muted tnum">
              {fmt(score!.points)} of {fmt(score!.maxPoints)} points
            </span>
            {autoScore && autoScore.points !== score!.points ? (
              <span className="xs muted tnum" data-testid="auto-score">
                Automatic before review: {fmt(autoScore.points)} / {fmt(autoScore.maxPoints)}
              </span>
            ) : null}
            {pct !== null ? (
              <>
                <span style={{ fontSize: 18, fontWeight: 600 }}>{ordinal(pct)} percentile</span>
                <span className="small ink2">
                  Higher than {higherThan}% of the {others.length} other candidate{others.length === 1 ? "" : "s"} scored for this job.
                </span>
              </>
            ) : (
              <span className="small ink2">The first candidate scored for this job.</span>
            )}
          </>
        ) : (
          <>
            <span className="display" style={{ fontSize: 40, lineHeight: 1 }} data-testid="final-score">
              —
            </span>
            <span className="small ink2">Submitted. Scoring is still running.</span>
          </>
        )}
        {review ? (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            <span className="badge b-accent" style={{ alignSelf: "flex-start" }}>
              <Icon name="eye" />
              Needs review · {review} task{review > 1 ? "s" : ""}
            </span>
            <span className="xs muted">Provisional until a recruiter or admin scores {review > 1 ? "them" : "it"}. The score may go up.</span>
          </div>
        ) : null}
      </div>

      {percent !== null ? (
        <figure style={{ flex: "2 1 420px", margin: 0 }}>
          <ScoreStrip me={percent} others={others.map((o) => o.percent)} pass={report.assessment?.passScore ?? null} label={first} />
        </figure>
      ) : null}

      {report.steps.length ? (
        <div style={{ flexBasis: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10 }}>
          {report.steps.map((s) => (
            <a
              key={s.id}
              href={`#step-${s.id}`}
              className="card"
              style={{ padding: "12px 14px", color: "var(--ink)", textDecoration: "none", display: "flex", flexDirection: "column", gap: 6 }}
            >
              <span className="small ink2">{s.title}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span className="tnum" style={{ fontSize: 22, fontWeight: 700 }}>
                  {s.score ? `${fmt(s.score.points)}/${fmt(s.score.maxPoints)}` : "—"}
                </span>
                <StepBadge step={s} short />
              </span>
            </a>
          ))}
        </div>
      ) : null}
      {openFlags ? (
        <p className="small" style={{ flexBasis: "100%", padding: "10px 14px", borderRadius: 8, background: "var(--warn-bg)", color: "var(--warn)", display: "flex", gap: 8 }}>
          <Icon name="flag" />
          <span style={{ color: "var(--ink)" }}>
            {openFlags} integrity flag{openFlags > 1 ? "s" : ""} to check. Flags don&apos;t change the score.
          </span>
        </p>
      ) : null}
    </section>
  );
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Where this candidate sits among everyone scored for the job, on a 0–100 line. */
function ScoreStrip({ me, others, pass, label }: { me: number; others: number[]; pass: number | null; label: string }) {
  const x = (p: number) => 24 + (Math.max(0, Math.min(100, p)) / 100) * 552;
  const mx = x(me);
  const high = Math.max(me, ...others);
  const flip = mx > 470;
  return (
    <svg
      viewBox="0 0 600 150"
      role="img"
      aria-label={`Score ${me} out of 100${others.length ? `; ${others.length} other candidates scored, highest ${high}` : ""}${pass !== null ? `; pass mark ${pass}` : ""}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <rect x="24" y="92" width="552" height="20" rx="10" fill="#EDF1FC" />
      {pass !== null ? (
        <>
          <line x1={x(pass)} y1="70" x2={x(pass)} y2="120" stroke="#5E6772" strokeDasharray="3 3" />
          <text x={x(pass)} y="64" fontSize="12" fill="#5E6772" textAnchor="middle" fontFamily="Inter, sans-serif">
            Pass {pass}
          </text>
        </>
      ) : null}
      {others.map((p, i) => (
        <circle key={i} cx={x(p)} cy="102" r="5" fill="#BBC7EF" stroke="#1B45CA" strokeWidth="1" />
      ))}
      <line x1={mx} y1="20" x2={mx} y2="112" stroke="#15181C" strokeWidth="2" />
      <circle cx={mx} cy="102" r="7" fill="#15181C" />
      <text x={flip ? mx - 8 : mx + 8} y="30" fontSize="13" fontWeight="600" fill="#15181C" fontFamily="Inter, sans-serif" textAnchor={flip ? "end" : "start"}>
        {label} · {me}
      </text>
      <text x="24" y="138" fontSize="11" fill="#5E6772" fontFamily="Inter, sans-serif">
        0
      </text>
      <text x="300" y="138" fontSize="11" fill="#5E6772" textAnchor="middle" fontFamily="Inter, sans-serif">
        {others.length ? `${others.length + 1} candidates scored` : "Only candidate scored so far"}
      </text>
      <text x="576" y="138" fontSize="11" fill="#5E6772" textAnchor="end" fontFamily="Inter, sans-serif">
        100
      </text>
    </svg>
  );
}

type ReportStep = CandidateReport["steps"][number];

function StepBadge({ step, short = false }: { step: ReportStep; short?: boolean }) {
  const s = step.score;
  if (!s) return null;
  if (s.needsReview && !s.review)
    return (
      <span className="badge b-accent">
        <Icon name="eye" />
        Needs review
      </span>
    );
  if (s.review)
    return (
      <span className="badge b-ok">
        <Icon name="check" />
        Reviewed{short ? "" : ` ${fmt(s.points)}/${fmt(s.maxPoints)}`}
      </span>
    );
  if (short) {
    if (s.points >= s.maxPoints) return null;
    return s.points > 0 ? <span className="badge b-warn">Partial</span> : <span className="badge b-bad">Missed</span>;
  }
  return <PointsBadge points={s.points} max={s.maxPoints} />;
}

function StepSection({
  n,
  step,
  first,
  orgId,
  attemptId,
  canReview,
}: {
  n: number;
  step: ReportStep;
  first: string;
  orgId: string;
  attemptId: string;
  canReview: boolean;
}) {
  const s = step.score;
  const headingId = `step-${step.id}-heading`;
  const isReply = step.type === "inbox_reply";
  const reviewable = !!s && (s.needsReview === true || !!s.review);

  const criteria: RubricCriterionInput[] = step.rows.map((r) => ({
    id: r.id,
    label: r.label,
    lookFor: r.expected,
    max: r.max ?? 0,
    earned: r.earned ?? 0,
    scored: !!s && (!s.needsReview || !!s.review) && r.earned !== undefined,
  }));

  return (
    <section id={`step-${step.id}`} aria-labelledby={headingId} className="card" style={{ overflow: "hidden", scrollMarginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <CardTitle id={headingId} size={16}>
          {n} · {step.title}
        </CardTitle>
        <StepBadge step={step} />
        {s?.review ? (
          <span className="xs muted">
            reviewed <ReportTime iso={s.review.at} format="day" />
          </span>
        ) : s?.needsReview ? (
          <span className="xs muted">Not yet reviewed by your team</span>
        ) : null}
        {s?.review && step.autoScore ? (
          <span className="xs muted tnum" data-testid={`auto-score-${step.id}`}>
            automatic {fmt(step.autoScore.points)} / {fmt(step.autoScore.maxPoints)}
          </span>
        ) : null}
      </div>

      {isReply ? (
        step.answerText !== null ? (
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", background: "var(--subtle)", fontSize: 13, color: "var(--ink-2)" }}>
            <span className="pre">“{step.answerText}”</span>
          </div>
        ) : (
          <div style={{ padding: "14px 20px", borderBottom: step.rows.length ? "1px solid var(--line)" : undefined }} className="small ink2">
            {first === "Candidate" ? "The candidate" : first} didn&apos;t write a reply.
          </div>
        )
      ) : step.answerText !== null ? (
        <pre className="small" style={{ margin: 0, padding: "14px 20px", maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--font)", background: "var(--subtle)", borderBottom: "1px solid var(--line)" }}>
          {step.answerText}
        </pre>
      ) : null}

      {isReply && step.rows.length ? (
        reviewable && canReview ? (
          <RubricReviewForm orgId={orgId} attemptId={attemptId} stepId={step.id} stepTitle={step.title} reviewed={!!s?.review} criteria={criteria} />
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th style={{ width: 90 }}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.map((c) => (
                    <tr key={c.id}>
                      <CriterionCell c={c} />
                      <td>
                        <CriterionPoints c={c} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reviewable && s?.needsReview && !s.review ? (
              <p className="small ink2" style={{ padding: "12px 20px" }}>
                Waiting for a recruiter or admin to score this task.
              </p>
            ) : null}
          </>
        )
      ) : step.rows.length ? (
        <AnswerTable rows={step.rows} first={first} />
      ) : null}
    </section>
  );
}

function Timeline({ report, flags }: { report: CandidateReport; flags: ReportFlag[] }) {
  const start = report.attempt?.startedAt ? Date.parse(report.attempt.startedAt) : null;
  const offset = (at: string) => {
    if (start === null) return "";
    const s = Math.max(0, Math.round((Date.parse(at) - start) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
  };
  const entries = [
    ...report.timeline.map((t) => ({ at: t.at, text: t.text, warn: false })),
    ...flags.map((f) => ({ at: f.events[0]?.at ?? f.media[0]?.at ?? f.createdAt, text: `Integrity flag: ${f.reason}`, warn: true })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!entries.length) return null;
  return (
    <section aria-labelledby="timeline-heading" className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <CardTitle id="timeline-heading" size={16}>
        Timeline
      </CardTitle>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", fontSize: 13 }}>
        {entries.map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            style={{ display: "flex", gap: 14, padding: "7px 0", borderBottom: i < entries.length - 1 ? "1px solid var(--line)" : undefined }}
          >
            <span className="tnum muted" style={{ width: 48, flex: "none" }}>
              {offset(e.at)}
            </span>
            <span style={e.warn ? { color: "var(--warn)" } : undefined}>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

