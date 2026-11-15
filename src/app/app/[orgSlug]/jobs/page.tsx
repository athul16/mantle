import Link from "next/link";
import { requireOrgMembership } from "@/lib/auth";
import { listAssessments, listJobs } from "@/lib/jobs/queries";
import { isPast } from "@/lib/jobs/status";
import { simulationName } from "./format";
import { CreateJobDialog } from "./job-forms";
import { JobsTable, type JobRow } from "./jobs-table";

export const metadata = { title: "Jobs · Mantle" };

export default async function JobsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/jobs">) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const canManage = role !== "viewer";
  const [jobs, assessments] = await Promise.all([listJobs(orgId), listAssessments(orgId)]);
  const base = `/app/${orgSlug}/jobs`;
  const libraryHref = `${base}/assessments`;
  const byId = new Map(assessments.map((a) => [a.id, a]));

  const rows: JobRow[] = jobs.map((j) => {
    const a = byId.get(j.assessmentId);
    const c = j.inviteCounts;
    return {
      id: j.id,
      title: j.title,
      simulation: a ? `${simulationName(a.scenarioTitle)} · ${a.timeLimitMinutes} min` : j.assessmentTitle,
      deadline: j.deadline,
      closed: isPast(j.deadline),
      done: c.completed,
      inProgress: c.started,
      // Expired invites were never started; revoked ones aren't candidates any more.
      notStarted: c.invited + c.expired,
    };
  });

  const options = assessments.map((a) => ({
    id: a.id,
    title: a.title,
    label: `${a.title} (${simulationName(a.scenarioTitle)}, ${a.timeLimitMinutes} min)`,
  }));
  const wanted = typeof query.assessment === "string" && byId.has(query.assessment) ? query.assessment : undefined;

  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 32px 48px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h1 style={{ fontSize: 28 }}>Jobs</h1>
        <span style={{ flex: 1 }} />
        {canManage && assessments.length > 0 ? (
          <CreateJobDialog
            orgId={orgId}
            assessments={options}
            jobsBase={base}
            libraryHref={libraryHref}
            defaultOpen={query.create === "1"}
            defaultAssessmentId={wanted}
          />
        ) : null}
      </div>

      {canManage && assessments.length === 0 ? (
        <div className="co-banner">
          <span className="small">
            Create an assessment first: pick a simulation in the <Link style={{ textDecoration: "underline", textUnderlineOffset: 2 }} href={libraryHref}>assessment</Link> library, then create a job that uses it.
          </span>
        </div>
      ) : null}
      {!canManage ? (
        <div className="co-banner">
          <span className="small">You have read-only access to jobs.</span>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <section className="card" style={{ padding: "28px 24px" }}>
          <p className="small muted">No jobs yet.</p>
        </section>
      ) : (
        <JobsTable jobs={rows} base={base} canManage={canManage} />
      )}
    </main>
  );
}
