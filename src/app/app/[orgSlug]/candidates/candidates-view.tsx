import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { Role } from "@/lib/auth";
import type { JobDetail } from "@/lib/jobs/queries";
import type { CandidateRow } from "@/lib/results/candidate-table";
import { ResultsTable } from "./results-table";

/**
 * The candidates list for one job, shared by the job page and the Candidates
 * tab: breadcrumb, heading with Export and "Invite candidates", then the table.
 */
export function CandidatesView({
  orgSlug,
  orgId,
  role,
  job,
  rows,
  crumbs,
  heading,
  deadlinePassed,
}: {
  orgSlug: string;
  orgId: string;
  role: Role;
  job: JobDetail;
  rows: CandidateRow[];
  crumbs: ReactNode;
  heading: ReactNode;
  deadlinePassed: boolean;
}) {
  const canManage = role !== "viewer";
  const actions =
    canManage && !deadlinePassed ? (
      <Link className="btn btn-primary" href={`/app/${orgSlug}/jobs/${job.id}/invite`}>
        <Icon name="userPlus" />
        Invite candidates
      </Link>
    ) : null;

  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "20px 32px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        {crumbs}
      </nav>
      {canManage && deadlinePassed ? (
        <div className="co-banner">
          <Icon name="clock" />
          <span>The invite deadline has passed, so no new invites can be sent.</span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
            {heading}
            <span style={{ flex: 1 }} />
            {actions}
          </div>
          <div className="card" style={{ padding: "40px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <span className="strong">No one invited to this job yet.</span>
            <span className="small muted">
              {actions ? "Invite candidates to send them their link." : "Candidates appear here once a recruiter invites them."}
            </span>
          </div>
        </>
      ) : (
        <ResultsTable
          rows={rows}
          reportBase={`/app/${orgSlug}/candidates`}
          ctx={{
            orgId,
            canManage,
            deadlinePassed,
            passScore: job.assessment?.passScore ?? null,
            jobTitle: job.title,
            timeLimitMinutes: job.assessment?.timeLimitMinutes,
            camera: job.assessment?.proctoring.camera ?? false,
            screen: job.assessment?.proctoring.screen ?? false,
          }}
          heading={heading}
          actions={actions}
        />
      )}
    </main>
  );
}
