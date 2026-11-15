"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createJob } from "./actions";

/** An assessment as the create-job form lists it. `label` adds the simulation and length. */
export type JobAssessmentOption = { id: string; title: string; label?: string };

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** End of the picked day in the browser's time zone, as an ISO timestamp. */
function endOfDayIso(date: string) {
  if (!date) return "";
  const d = new Date(`${date}T23:59:59`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="co-err">
      <Icon name="alert" className="i-sm" />
      {text}
    </p>
  );
}

/**
 * The create-job form (the body of the prototype's "Create job" dialog). On
 * success it opens the new job's invite page when `jobsBase` is given.
 */
export function CreateJobForm({
  orgId,
  assessments,
  defaultAssessmentId,
  jobsBase,
  libraryHref,
  onCancel,
}: {
  orgId: string;
  assessments: JobAssessmentOption[];
  defaultAssessmentId?: string;
  /** `/app/<slug>/jobs`: where the new job's invite page lives. */
  jobsBase?: string;
  libraryHref?: string;
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(createJob, undefined);
  const router = useRouter();
  const [defaultDate] = useState(() => isoDate(new Date(Date.now() + 14 * 864e5)));
  const [date, setDate] = useState(defaultDate);
  const [today] = useState(() => isoDate(new Date()));
  const errors = state?.fieldErrors;

  useEffect(() => {
    if (state?.id && jobsBase) router.push(`${jobsBase}/${state.id}/invite`);
  }, [state?.id, jobsBase, router]);

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column" }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="deadline" value={endOfDayIso(date)} />
      <div style={{ padding: "12px 24px 4px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="label" htmlFor="cj-role">Role name</label>
          <input
            id="cj-role"
            name="title"
            className={`input${errors?.title ? " invalid" : ""}`}
            required
            autoFocus
            placeholder="Staff Accountant Intern — Summer 2027"
            aria-invalid={errors?.title ? true : undefined}
            aria-describedby={errors?.title ? "cj-role-help cj-role-err" : "cj-role-help"}
          />
          <p id="cj-role-help" className="help">Candidates see this on their invite.</p>
          <FieldError id="cj-role-err" text={errors?.title?.[0]} />
        </div>
        <div>
          <label className="label" htmlFor="cj-asmt">Assessment</label>
          <select
            id="cj-asmt"
            name="assessmentId"
            required
            className="select"
            defaultValue={defaultAssessmentId ?? assessments[0]?.id}
            aria-describedby={errors?.assessmentId ? "cj-asmt-err" : undefined}
          >
            {assessments.map((a) => (
              <option key={a.id} value={a.id}>{a.label ?? a.title}</option>
            ))}
          </select>
          {libraryHref ? (
            <p className="help">
              <Link style={{ textDecoration: "underline", textUnderlineOffset: 2 }} href={libraryHref}>Browse the library</Link> to set up a different one.
            </p>
          ) : null}
          <FieldError id="cj-asmt-err" text={errors?.assessmentId?.[0]} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <div style={{ gridColumn: "span 2" }}>
            <label className="label" htmlFor="cj-dl">Invites close</label>
            <input
              id="cj-dl"
              name="deadlineDate"
              type="date"
              className={`input${errors?.deadline ? " invalid" : ""}`}
              style={{ maxWidth: "calc(50% - 6px)" }}
              required
              min={today}
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
              aria-invalid={errors?.deadline ? true : undefined}
              aria-describedby={errors?.deadline ? "cj-dl-help cj-dl-err" : "cj-dl-help"}
            />
            <p id="cj-dl-help" className="help">Invites expire at the end of this day, in your time zone.</p>
            <FieldError id="cj-dl-err" text={errors?.deadline?.[0]} />
          </div>
        </div>
        {state?.error || (state?.message && !jobsBase) ? <FormMessage error={state?.error} message={state?.message} /> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "20px 24px 22px" }}>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <Button type="submit" disabled={pending || Boolean(state?.id && jobsBase)}>
          {pending || (state?.id && jobsBase) ? "Creating…" : "Create and invite candidates"}
        </Button>
      </div>
    </form>
  );
}

/** The "Create job" button and its dialog (prototype k4-jobs-a). */
export function CreateJobDialog({
  orgId,
  assessments,
  jobsBase,
  libraryHref,
  defaultOpen = false,
  defaultAssessmentId,
}: {
  orgId: string;
  assessments: JobAssessmentOption[];
  jobsBase: string;
  libraryHref: string;
  defaultOpen?: boolean;
  defaultAssessmentId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="plus" />
        Create job
      </button>
      {open ? (
        <>
          <div className="scrim" style={{ position: "fixed", zIndex: 300 }} onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cj-title"
            className="modal"
            style={{ position: "fixed", left: "50%", top: 120, transform: "translateX(-50%)", width: 520, maxWidth: "calc(100% - 32px)", zIndex: 301, animation: "rise .18s ease-out" }}
          >
            <div style={{ display: "flex", alignItems: "center", padding: "20px 24px 6px" }}>
              <h2 id="cj-title" style={{ fontSize: 20 }}>Create job</h2>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon name="x" />
              </button>
            </div>
            <CreateJobForm
              orgId={orgId}
              assessments={assessments}
              defaultAssessmentId={defaultAssessmentId}
              jobsBase={jobsBase}
              libraryHref={libraryHref}
              onCancel={() => setOpen(false)}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
