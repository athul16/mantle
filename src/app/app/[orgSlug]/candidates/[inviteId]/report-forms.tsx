"use client";

import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { NOTE_MAX_CHARS, VOTE_LABELS, VOTES } from "@/lib/results/schemas";
import { addNote, deleteNote, reviewRubricStep } from "../actions";

export type RubricCriterionInput = { id: string; label: string; max: number; earned: number };

const inputClass = "w-24 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums dark:border-neutral-700";

/** Points per rubric criterion for one step. Shown to admins and recruiters only. */
export function RubricReviewForm({
  orgId,
  attemptId,
  stepId,
  stepTitle,
  criteria,
  reviewed,
}: {
  orgId: string;
  attemptId: string;
  stepId: string;
  stepTitle: string;
  criteria: RubricCriterionInput[];
  reviewed: boolean;
}) {
  const [state, action, pending] = useActionState(reviewRubricStep, undefined);
  return (
    <form action={action} aria-label={`Review ${stepTitle}`} className="space-y-3 rounded-md border border-purple-200 bg-purple-50/50 p-3 dark:border-purple-900 dark:bg-purple-950/30">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="stepId" value={stepId} />
      <p className="text-sm font-medium">{reviewed ? "Change the rubric scores" : "Enter rubric scores"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {criteria.map((c) => {
          const err = state?.fieldErrors?.[`score:${c.id}`]?.[0];
          return (
            <div key={c.id}>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {c.label} <span className="text-neutral-600 dark:text-neutral-400">(0–{c.max})</span>
                </span>
                <input
                  name={`score:${c.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={c.max}
                  step="any"
                  required
                  defaultValue={reviewed ? c.earned : ""}
                  aria-invalid={err ? true : undefined}
                  className={inputClass}
                />
              </label>
              {err ? <span className="text-sm text-red-700 dark:text-red-400">{err}</span> : null}
            </div>
          );
        })}
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save review"}</Button>
      <FormMessage message={state?.message} />
      <FormMessage error={state?.error} />
    </form>
  );
}

export function AddNoteForm({ orgId, attemptId }: { orgId: string; attemptId: string }) {
  const [state, action, pending] = useActionState(addNote, undefined);
  const bodyError = state?.fieldErrors?.body?.[0];
  return (
    <form action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Add a note</span>
        <textarea
          name="body"
          rows={3}
          maxLength={NOTE_MAX_CHARS}
          aria-invalid={bodyError ? true : undefined}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
      </label>
      {bodyError ? <p className="text-sm text-red-700 dark:text-red-400">{bodyError}</p> : null}
      <fieldset className="flex flex-wrap items-center gap-4 text-sm">
        <legend className="mb-1 text-sm font-medium">Vote (optional)</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="vote" value="" defaultChecked /> No vote
        </label>
        {VOTES.map((v) => (
          <label key={v} className="flex items-center gap-1.5">
            <input type="radio" name="vote" value={v} /> {VOTE_LABELS[v]}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
      <FormMessage message={state?.message} />
      <FormMessage error={state?.error} />
    </form>
  );
}

export function DeleteNoteButton({ orgId, noteId }: { orgId: string; noteId: string }) {
  const [state, action, pending] = useActionState(deleteNote, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="noteId" value={noteId} />
      <button type="submit" disabled={pending} className="text-xs text-red-700 underline disabled:opacity-50 dark:text-red-400">
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state?.error ? <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.error}</span> : null}
    </form>
  );
}
