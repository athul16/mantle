import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { requireOrgMembership } from "@/lib/auth";
import { MAX_INVITES_PER_BATCH } from "@/lib/jobs/emails";
import { getJob, listInvites } from "@/lib/jobs/queries";
import { canResend, canRevoke, isPast, type InviteStatus } from "@/lib/jobs/status";
import { LocalDate } from "../local-date";
import { InviteCandidatesForm, InviteRowActions } from "./invite-forms";

export const metadata = { title: "Job · Assessment Platform" };

const STATUS_STYLES: Record<InviteStatus, string> = {
  invited: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  started: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  expired: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  revoked: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export default async function JobPage({ params }: PageProps<"/app/[orgSlug]/jobs/[jobId]">) {
  const { orgSlug, jobId } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  if (!z.uuid().safeParse(jobId).success) notFound();
  const job = await getJob(orgId, jobId);
  if (!job) notFound();
  const invites = await listInvites(orgId, jobId);
  const canManage = role !== "viewer";
  const deadlinePassed = isPast(job.deadline);
  const a = job.assessment;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${orgSlug}/jobs`} className="text-sm text-neutral-500 hover:underline">← Jobs</Link>
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Invite deadline <LocalDate iso={job.deadline} withTime />
          {a ? (
            <>
              {" · "}
              <Link href={`/app/${orgSlug}/jobs/assessments`} className="underline">{a.title}</Link>
              {` · ${a.timeLimitMinutes} min · camera ${a.proctoring.camera ? "on" : "off"} · screen ${a.proctoring.screen ? "on" : "off"}`}
              {a.lockedAt ? " · settings locked" : ""}
            </>
          ) : null}
        </p>
      </div>

      {canManage ? (
        deadlinePassed ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">
            The invite deadline has passed, so no new invites can be sent.
          </p>
        ) : (
          <InviteCandidatesForm orgId={orgId} jobId={job.id} max={MAX_INVITES_PER_BATCH} />
        )
      ) : null}

      <section className="space-y-2">
        <h2 className="font-medium">Candidates ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-neutral-500">No one invited yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800">
                <tr>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Invited</th>
                  <th className="px-4 py-2 font-medium">Expires</th>
                  {canManage ? <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">
                      {i.email}
                      {i.candidateName ? <span className="ml-2 text-xs text-neutral-500">{i.candidateName}</span> : null}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[i.status]}`}>{i.status}</span>
                    </td>
                    <td className="px-4 py-2"><LocalDate iso={i.sentAt} /></td>
                    <td className="px-4 py-2"><LocalDate iso={i.expiresAt} /></td>
                    {canManage ? (
                      <td className="px-4 py-2 text-right">
                        <InviteRowActions
                          orgId={orgId}
                          inviteId={i.id}
                          email={i.email}
                          canResend={canResend(i.status) && !deadlinePassed}
                          canRevoke={canRevoke(i.status)}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
