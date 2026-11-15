import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { Icon } from "@/components/icons";
import { requireOrgMembership } from "@/lib/auth";
import { getJob } from "@/lib/jobs/queries";
import { isPast } from "@/lib/jobs/status";
import { listJobCandidates } from "@/lib/results/candidates";
import { CandidatesView } from "../../candidates/candidates-view";
import { JobHeading } from "../../candidates/job-heading";

export const metadata = { title: "Job · Mantle" };

// A job's candidates (screen 6, prototype "Candidates · list"): everyone
// invited, with status, score, percentile, per-task scores, integrity label
// and team votes. Invites are sent from /jobs/<id>/invite.
export default async function JobPage({ params }: PageProps<"/app/[orgSlug]/jobs/[jobId]">) {
  const { orgSlug, jobId } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  if (!z.uuid().safeParse(jobId).success) notFound();
  const job = await getJob(orgId, jobId);
  if (!job) notFound();
  const rows = await listJobCandidates(orgId, jobId);

  return (
    <CandidatesView
      orgSlug={orgSlug}
      orgId={orgId}
      role={role}
      job={job}
      rows={rows}
      crumbs={
        <>
          <Link href={`/app/${orgSlug}/jobs`}>Jobs</Link>
          <Icon name="chevR" className="i-sm muted" />
          <span className="muted" aria-current="page">
            {job.title}
          </span>
        </>
      }
      heading={<JobHeading job={job} count={rows.length} />}
      deadlinePassed={isPast(job.deadline)}
    />
  );
}
