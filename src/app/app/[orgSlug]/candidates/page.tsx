import Link from "next/link";
import * as z from "zod";
import { requireOrgMembership } from "@/lib/auth";
import { getJob, listJobs } from "@/lib/jobs/queries";
import { listJobResults } from "@/lib/results/queries";
import { ResultsTable } from "./results-table";

export const metadata = { title: "Candidates · Assessment Platform" };

// Results per job: /candidates lists the jobs, /candidates?job=<id> shows that
// job's candidates with score, time taken and submit date.
export default async function CandidatesPage({ params, searchParams }: PageProps<"/app/[orgSlug]/candidates">) {
  const { orgSlug } = await params;
  const { orgId } = await requireOrgMembership(orgSlug);
  const jobParam = (await searchParams).job;
  const jobId = typeof jobParam === "string" && z.uuid().safeParse(jobParam).success ? jobParam : null;
  const base = `/app/${orgSlug}/candidates`;

  const [jobs, job] = await Promise.all([listJobs(orgId), jobId ? getJob(orgId, jobId) : Promise.resolve(null)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{job ? `Candidates · ${job.title}` : "Candidates"}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {job ? (
            <>
              <Link href={`/app/${orgSlug}/jobs/${job.id}`} className="underline">Job details and invites</Link>
              {job.assessment?.passScore != null ? ` · pass score ${job.assessment.passScore}%` : ""}
            </>
          ) : (
            "Pick a job to see its candidates, scores and reports."
          )}
        </p>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">
          No jobs yet. <Link href={`/app/${orgSlug}/jobs`} className="underline">Create a job</Link> and invite candidates first.
        </p>
      ) : (
        <nav aria-label="Jobs" className="flex flex-wrap gap-2">
          {jobs.map((j) => {
            const active = j.id === job?.id;
            const total = Object.values(j.inviteCounts).reduce((a, b) => a + b, 0);
            return (
              <Link
                key={j.id}
                href={`${base}?job=${j.id}`}
                aria-current={active ? "page" : undefined}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  active
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                }`}
              >
                {j.title} <span className="tabular-nums">({j.inviteCounts.completed}/{total})</span>
              </Link>
            );
          })}
        </nav>
      )}

      {jobId && !job ? <p className="text-sm text-red-700 dark:text-red-400">That job was not found.</p> : null}
      {job ? <JobResults orgId={orgId} jobId={job.id} reportBase={base} /> : null}
    </div>
  );
}

async function JobResults({ orgId, jobId, reportBase }: { orgId: string; jobId: string; reportBase: string }) {
  const rows = await listJobResults(orgId, jobId);
  if (rows.length === 0) return <p className="text-sm text-neutral-600 dark:text-neutral-400">No one invited to this job yet.</p>;
  return <ResultsTable rows={rows} reportBase={reportBase} />;
}
