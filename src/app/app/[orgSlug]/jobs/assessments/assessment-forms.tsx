"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import type { AssessmentSummary } from "@/lib/jobs/queries";
import { cloneAssessment, createAssessment, updateAssessment } from "../actions";
import { selectClass } from "../job-forms";

type FieldErrors = Record<string, string[] | undefined> | undefined;

function SettingsFields({
  errors,
  defaults,
}: {
  errors: FieldErrors;
  defaults: { title?: string; minutes: number; passScore: number | null; camera: boolean; screen: boolean };
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Title" name="title" required defaultValue={defaults.title} error={errors?.title?.[0]} />
        <Field label="Time limit (minutes)" name="timeLimitMinutes" type="number" min={1} max={240} required defaultValue={defaults.minutes} error={errors?.timeLimitMinutes?.[0]} />
        <Field label="Pass score (%)" name="passScore" type="number" min={0} max={100} step="any" placeholder="optional" defaultValue={defaults.passScore ?? undefined} error={errors?.passScore?.[0]} />
      </div>
      <fieldset className="flex flex-wrap gap-6 text-sm">
        <legend className="mb-1 font-medium">Proctoring</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="camera" defaultChecked={defaults.camera} /> Camera snapshots
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="screen" defaultChecked={defaults.screen} /> Screen share
        </label>
      </fieldset>
    </>
  );
}

export function CreateAssessmentForm({ orgId, scenarios }: { orgId: string; scenarios: { id: string; label: string; minutes: number }[] }) {
  const [state, action, pending] = useActionState(createAssessment, undefined);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const minutes = scenarios.find((s) => s.id === scenarioId)?.minutes ?? 45;

  return (
    <form action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">New assessment</h2>
      <input type="hidden" name="orgId" value={orgId} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Simulation</span>
        <select name="scenarioId" value={scenarioId} onChange={(e) => setScenarioId(e.currentTarget.value)} className={selectClass}>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        {state?.fieldErrors?.scenarioId?.[0] ? <span className="text-sm text-red-600">{state.fieldErrors.scenarioId[0]}</span> : null}
      </label>
      {/* Remount when the scenario changes so the suggested time limit updates. */}
      <div key={scenarioId} className="space-y-3">
        <SettingsFields errors={state?.fieldErrors} defaults={{ minutes, passScore: null, camera: true, screen: true }} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create assessment"}</Button>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}

export function EditAssessmentForm({ orgId, assessment }: { orgId: string; assessment: AssessmentSummary }) {
  const [state, action, pending] = useActionState(updateAssessment, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm underline">
        Edit settings
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="assessmentId" value={assessment.id} />
      <SettingsFields
        errors={state?.fieldErrors}
        defaults={{
          title: assessment.title,
          minutes: assessment.timeLimitMinutes,
          passScore: assessment.passScore,
          camera: assessment.proctoring.camera,
          screen: assessment.proctoring.screen,
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
      </div>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}

export function CloneAssessmentButton({ orgId, assessmentId }: { orgId: string; assessmentId: string }) {
  const [state, action, pending] = useActionState(cloneAssessment, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <Button type="submit" variant="secondary" disabled={pending} className="px-3 py-1.5">
        {pending ? "Cloning…" : "Clone"}
      </Button>
      {state?.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  );
}
