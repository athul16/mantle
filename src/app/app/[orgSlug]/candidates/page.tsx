import Link from "next/link";
import * as z from "zod";
import { requireOrgMembership } from "@/lib/auth";
import { getJob, listJobs } from "@/lib/jobs/queries";
import { isPast } from "@/lib/jobs/status";
import { listJobCandidates } from "@/lib/results/candidates";
import { Icon } from "@/components/icons";
import { CandidatesView } from "./candidates-view";
import { JobHeading } from "./job-heading";
import { JobPicker } from "./job-picker";

export const metadata = { title: "Candidates · Mantle" };

// The Candidates tab: one job's candidates at a time (?job=<id>), with a job
// picker. Without ?job it opens the newest job that has candidates.
export default async function CandidatesPage({ params, searchParams }: PageProps<"/app/[orgSlug]/candidates">) {
  const { orgSlug } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const jobParam = (await searchParams).job;
  const requested = typeof jobParam === "string" && z.uuid().safeParse(jobParam).success ? jobParam : null;
  const base = `/app/${orgSlug}/candidates`;

  const jobs = await listJobs(orgId);
  const total = (j: (typeof jobs)[number]) => Object.values(j.inviteCounts).reduce((a, b) => a + b, 0);
  const fallback = jobs.find((j) => total(j) > 0) ?? jobs[0];
  const jobId = requested ?? fallback?.id ?? null;
  const job = jobId ? await getJob(orgId, jobId) : null;

  if (!job) {
    return (
      <main style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 32px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontSize: 26 }}>Candidates</h1>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
          {requested ? (
            <span className="strong">That job was not found.</span>
          ) : (
            <>
              <span className="strong">No jobs yet</span>
              <span className="small muted">
                <Link href={`/app/${orgSlug}/jobs`}>Create a job</Link> and invite candidates first.
              </span>
            </>
          )}
        </div>
      </main>
    );
  }

  const rows = await listJobCandidates(orgId, job.id);
  const picker = jobs.length > 1 ? <JobPicker base={base} current={job.id} jobs={jobs.map((j) => ({ id: j.id, title: j.title, count: total(j) }))} /> : null;
  return (
    <CandidatesView
      orgSlug={orgSlug}
      orgId={orgId}
      role={role}
      job={job}
      rows={rows}
      crumbs={
        <>
          <span className="muted">Candidates</span>
          <Icon name="chevR" className="i-sm muted" />
          <Link href={`/app/${orgSlug}/jobs/${job.id}`} aria-current="page">
            {job.title}
          </Link>
        </>
      }
      heading={<JobHeading job={job} count={rows.length} picker={picker} />}
      deadlinePassed={isPast(job.deadline)}
    />
  );
}
