import Link from "next/link";
import { requireOrgMembership } from "@/lib/auth";
import { listAssessments, listJobs } from "@/lib/jobs/queries";
import { CreateJobForm } from "./job-forms";
import { LocalDate } from "./local-date";

export const metadata = { title: "Jobs · Assessment Platform" };

export default async function JobsPage({ params }: PageProps<"/app/[orgSlug]/jobs">) {
  const { orgSlug } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const canManage = role !== "viewer";
  const [jobs, assessments] = await Promise.all([listJobs(orgId), listAssessments(orgId)]);
  const base = `/app/${orgSlug}/jobs`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Each job is a hiring round with one assessment and an invite deadline.
            {canManage ? "" : " You have read-only access."}
          </p>
        </div>
        <Link href={`${base}/assessments`} className="text-sm underline">
          Assessments ({assessments.length})
        </Link>
      </div>

      {canManage ? (
        assessments.length > 0 ? (
          <CreateJobForm orgId={orgId} assessments={assessments.map((a) => ({ id: a.id, title: a.title }))} />
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">
            Create an <Link href={`${base}/assessments`} className="underline">assessment</Link> first, then a job that uses it.
          </p>
        )
      ) : null}

      {jobs.length === 0 ? (
        <p className="text-sm text-neutral-500">No jobs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Assessment</th>
                <th className="px-4 py-2 font-medium">Invite deadline</th>
                <th className="px-4 py-2 font-medium">Invited</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2">
                    <Link href={`${base}/${j.id}`} className="font-medium underline-offset-2 hover:underline">
                      {j.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">{j.assessmentTitle}</td>
                  <td className="px-4 py-2"><LocalDate iso={j.deadline} /></td>
                  <td className="px-4 py-2">{j.inviteCounts.invited}</td>
                  <td className="px-4 py-2">{j.inviteCounts.started}</td>
                  <td className="px-4 py-2">{j.inviteCounts.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
