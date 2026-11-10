"use client";

import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { reviewFlag } from "./flag-actions";

/** Confirm or clear one flag, with a note. Admins and recruiters only (the action checks again). */
export function FlagReviewForm({ orgId, flagId, reason, reviewed }: { orgId: string; flagId: string; reason: string; reviewed: boolean }) {
  const [state, action, pending] = useActionState(reviewFlag, undefined);
  const noteError = state?.fieldErrors?.note?.[0];
  const noteId = `flag-note-${flagId}`;
  return (
    <form action={action} aria-label={`Review flag: ${reason}`} className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="flagId" value={flagId} />
      <label htmlFor={noteId} className="block text-sm font-medium">
        Note
      </label>
      <textarea
        id={noteId}
        name="note"
        rows={2}
        maxLength={2000}
        aria-invalid={noteError ? true : undefined}
        aria-describedby={noteError ? `${noteId}-error` : undefined}
        placeholder={reviewed ? "Why are you changing the decision?" : "What did you check, and what did you find?"}
        className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      />
      {noteError ? (
        <p id={`${noteId}-error`} className="text-sm text-red-700 dark:text-red-400">
          {noteError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="confirmed" disabled={pending}>
          Confirm flag
        </Button>
        <Button type="submit" name="decision" value="cleared" variant="secondary" disabled={pending}>
          Clear flag
        </Button>
      </div>
      <FormMessage message={state?.message} />
      <FormMessage error={state?.error} />
    </form>
  );
}
