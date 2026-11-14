"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui";
import { reviewFlag } from "./flag-actions";

/** Confirm or clear one flag, with a required note. Admins and recruiters only (the action checks again). */
export function FlagReviewForm({ orgId, flagId, reason, reviewed }: { orgId: string; flagId: string; reason: string; reviewed: boolean }) {
  const [state, action, pending] = useActionState(reviewFlag, undefined);
  const noteError = state?.fieldErrors?.note?.[0];
  const noteId = `flag-note-${flagId}${reviewed ? "-change" : ""}`;
  return (
    <form action={action} aria-label={`Review flag: ${reason}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="flagId" value={flagId} />
      <label htmlFor={noteId} className="xs strong" style={{ color: "var(--ink)" }}>
        Your note (required)
      </label>
      <textarea
        id={noteId}
        name="note"
        rows={2}
        maxLength={2000}
        className={noteError ? "textarea invalid" : "textarea"}
        style={{ fontSize: 13 }}
        aria-invalid={noteError ? true : undefined}
        aria-describedby={noteError ? `${noteId}-error` : undefined}
        placeholder={reviewed ? "Why are you changing the decision?" : "What did you check, and what did you find?"}
      />
      {noteError ? (
        <p id={`${noteId}-error`} className="co-err" style={{ marginTop: 0 }}>
          {noteError}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" name="decision" value="confirmed" className="btn btn-sm" style={{ flex: 1 }} disabled={pending}>
          Confirm flag
        </button>
        <button type="submit" name="decision" value="cleared" className="btn btn-sm" style={{ flex: 1 }} disabled={pending}>
          Clear flag
        </button>
      </div>
      <FormMessage message={state?.message} />
      <FormMessage error={state?.error} />
    </form>
  );
}
