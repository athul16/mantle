import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { Icon } from "@/components/icons";
import { requireOrgMembership } from "@/lib/auth";
import { MAX_INVITES_PER_BATCH } from "@/lib/jobs/emails";
import { buildInviteEmail } from "@/lib/jobs/invites";
import { getJob, listAssessments, listInvites } from "@/lib/jobs/queries";
import { isPast } from "@/lib/jobs/status";
import { simulationName } from "../../format";
import { InviteCandidatesForm } from "./invite-candidates-form";

export const metadata = { title: "Invite candidates · Mantle" };

/** Invite candidates to a job (prototype k5-invite-a). */
export default async function InvitePage({ params }: PageProps<"/app/[orgSlug]/jobs/[jobId]/invite">) {
  const { orgSlug, jobId } = await params;
  const { orgId, orgName, role } = await requireOrgMembership(orgSlug);
  if (!z.uuid().safeParse(jobId).success) notFound();
  const jobHref = `/app/${orgSlug}/jobs/${jobId}`;
  if (role === "viewer") redirect(jobHref);
  const job = await getJob(orgId, jobId);
  if (!job) notFound();
  const [invites, assessments] = await Promise.all([listInvites(orgId, jobId), listAssessments(orgId)]);
  const a = job.assessment;
  const scenarioTitle = assessments.find((x) => x.id === a?.id)?.scenarioTitle;
  const closed = isPast(job.deadline);

  // The real email, built with a placeholder link, so the preview matches what candidates get.
  const sample = buildInviteEmail({
    orgName,
    jobTitle: job.title,
    link: "",
    expiresAt: job.deadline ? new Date(job.deadline) : new Date(),
    minutes: a?.timeLimitMinutes,
    needsWebcam: a?.proctoring.camera,
    candidateName: null,
  });
  // Line 1 is the greeting ("Hi,"); line 2 says who invited them and for how long.
  const lines = sample.text.split("\n").filter((l) => l.trim());
  const body = `Hi {first name}, ${lines[1] ?? ""}`.trim();

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px 48px", display: "flex", flexDirection: "column", gap: 18 }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <Link href={`/app/${orgSlug}/jobs`}>Jobs</Link>
        <Icon name="chevR" className="i-sm muted" />
        <Link href={jobHref}>{job.title}</Link>
        <Icon name="chevR" className="i-sm muted" />
        <span className="muted">Invite</span>
      </nav>
      <h1 style={{ fontSize: 26 }}>Invite candidates</h1>
      {closed ? (
        <div className="co-banner">
          <Icon name="lock" />
          <span className="small">The invite deadline has passed, so no new invites can be sent.</span>
        </div>
      ) : (
        <InviteCandidatesForm
          orgId={orgId}
          jobId={job.id}
          max={MAX_INVITES_PER_BATCH}
          existingEmails={invites.filter((i) => i.status === "invited" || i.status === "started" || i.status === "completed").map((i) => i.email.toLowerCase())}
          summary={{
            assessment: scenarioTitle ? simulationName(scenarioTitle) : (a?.title ?? "—"),
            minutes: a?.timeLimitMinutes ?? null,
            deadline: job.deadline,
          }}
          emailPreview={{ subject: sample.subject, body }}
          jobHref={jobHref}
        />
      )}
    </main>
  );
}
