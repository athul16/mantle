import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { JobDetail } from "@/lib/jobs/queries";
import { isPast } from "@/lib/jobs/status";
import { ShortDate } from "./dates";

/** A job's title and meta line (assessment · minutes · candidates · invites close), as on the prototype's candidates list. */
export function JobHeading({ job, count, picker }: { job: JobDetail; count: number; picker?: ReactNode }) {
  const a = job.assessment;
  const closed = isPast(job.deadline);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h1 style={{ fontSize: 26 }}>{job.title}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
        {picker}
        {a ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="grid" className="i-sm" />
              {a.title}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="clock" className="i-sm" />
              {a.timeLimitMinutes} min
            </span>
          </>
        ) : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="users" className="i-sm" />
          {count} candidate{count === 1 ? "" : "s"}
        </span>
        {job.deadline ? (
          <span>
            {closed ? "Invites closed " : "Invites close "}
            <ShortDate iso={job.deadline} />
          </span>
        ) : null}
        {a?.passScore != null ? <span>Pass mark {a.passScore}</span> : null}
      </div>
    </div>
  );
}
