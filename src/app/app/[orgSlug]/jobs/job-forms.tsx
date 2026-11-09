"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { createJob } from "./actions";

export const selectClass = "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";

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

export function CreateJobForm({ orgId, assessments }: { orgId: string; assessments: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(createJob, undefined);
  const [defaultDate] = useState(() => isoDate(new Date(Date.now() + 14 * 864e5)));
  const [date, setDate] = useState(defaultDate);
  const [today] = useState(() => isoDate(new Date()));

  return (
    <form action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">New job</h2>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="deadline" value={endOfDayIso(date)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Job title" name="title" required placeholder="Audit intern, summer 2027" error={state?.fieldErrors?.title?.[0]} />
        <label className="block space-y-1">
          <span className="text-sm font-medium">Assessment</span>
          <select name="assessmentId" required className={selectClass} defaultValue={assessments[0]?.id}>
            {assessments.map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
          {state?.fieldErrors?.assessmentId?.[0] ? <span className="text-sm text-red-600">{state.fieldErrors.assessmentId[0]}</span> : null}
        </label>
        <Field
          label="Invite deadline"
          name="deadlineDate"
          type="date"
          required
          min={today}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
          error={state?.fieldErrors?.deadline?.[0]}
        />
      </div>
      <p className="text-xs text-neutral-500">Invites expire at the end of the deadline day, in your time zone.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create job"}</Button>
      </div>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}
