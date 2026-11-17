"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icons";
import { FormMessage } from "@/components/ui";
import { NOTE_MAX_CHARS, VOTES } from "@/lib/results/schemas";
import { addNote, deleteNote, reviewRubricStep } from "../actions";

export type RubricCriterionInput = { id: string; label: string; lookFor: string; max: number; earned: number; scored: boolean };

function pts(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Read-only points for one criterion: a badge once scored, a dash while it waits for review. */
export function CriterionPoints({ c }: { c: RubricCriterionInput }) {
  if (!c.scored) return <span className="muted">—</span>;
  const cls = c.earned >= c.max ? "badge b-ok" : c.earned > 0 ? "badge b-warn" : "badge b-bad";
  return (
    <span className={`${cls} tnum`}>
      {pts(c.earned)}/{pts(c.max)}
    </span>
  );
}

export function CriterionCell({ c }: { c: RubricCriterionInput }) {
  return (
    <td className="small">
      <span className="strong">{c.label}</span>
      {c.lookFor ? (
        <span className="xs muted" style={{ display: "block", marginTop: 2 }}>
          Look for: {c.lookFor}
        </span>
      ) : null}
    </td>
  );
}

/** Points per rubric criterion for one step, as the prototype's "Your score" table. Admins and recruiters only. */
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
  // Controlled, so React's reset after a submit doesn't wipe what was typed when the save fails.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(criteria.map((c) => [c.id, reviewed ? String(c.earned) : ""])),
  );
  return (
    <form action={action} aria-label={`Review ${stepTitle}`}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="stepId" value={stepId} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: "46%" }}>Criterion</th>
              <th style={{ width: 90 }}>Points</th>
              <th style={{ width: 150 }}>Your score</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => {
              const err = state?.fieldErrors?.[`score:${c.id}`]?.[0];
              return (
                <tr key={c.id}>
                  <CriterionCell c={c} />
                  <td>
                    <CriterionPoints c={c} />
                  </td>
                  <td>
                    <span className="row g6">
                      <input
                        name={`score:${c.id}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={c.max}
                        step="any"
                        required
                        value={values[c.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                        aria-label={`Your score for ${c.label} (0–${c.max})`}
                        aria-invalid={err ? true : undefined}
                        className={err ? "input invalid tnum" : "input tnum"}
                        style={{ width: 72, height: 30, fontSize: 13, textAlign: "right" }}
                      />
                      <span className="xs muted tnum">/ {pts(c.max)}</span>
                    </span>
                    {err ? <span className="co-err xs">{err}</span> : null}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3} style={{ borderBottom: 0, background: "var(--subtle)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span className="small ink2">Your scores replace the provisional ones.</span>
                  <span style={{ flex: 1 }} />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                    {pending ? "Saving…" : reviewed ? "Update review" : "Save review"}
                  </button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {state?.message || state?.error ? (
        <div style={{ padding: "0 20px 14px" }}>
          <FormMessage message={state?.message} />
          <FormMessage error={state?.error} />
        </div>
      ) : null}
    </form>
  );
}

const VOTE_BUTTONS = { hire: { icon: "up", label: "Hire" }, no_hire: { icon: "down", label: "No hire" }, unsure: { icon: "unsure", label: "Unsure" } } as const;

/** Hire / No hire / Unsure. Each click is saved as a note with a vote; the newest one per person counts. */
export function VoteButtons({ orgId, attemptId, myVote }: { orgId: string; attemptId: string; myVote: (typeof VOTES)[number] | null }) {
  const [state, action, pending] = useActionState(addNote, undefined);
  return (
    <form action={action} aria-label="Your vote" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="body" value="" />
      <div style={{ display: "flex", gap: 8 }}>
        {VOTES.map((v) => {
          const on = myVote === v;
          return (
            <button
              key={v}
              type="submit"
              name="vote"
              value={v}
              className="btn btn-sm"
              style={{ flex: 1, ...(on ? { borderColor: "var(--ink)", background: "var(--subtle)" } : {}) }}
              aria-pressed={on}
              disabled={pending}
            >
              <Icon name={VOTE_BUTTONS[v].icon} />
              {VOTE_BUTTONS[v].label}
            </button>
          );
        })}
      </div>
      {state?.error ? <FormMessage error={state.error} /> : null}
    </form>
  );
}

export function AddNoteForm({ orgId, attemptId }: { orgId: string; attemptId: string }) {
  const [state, action, pending] = useActionState(addNote, undefined);
  const bodyError = state?.fieldErrors?.body?.[0];
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <label className="label" htmlFor="note-body" style={{ margin: 0 }}>
        Add a note
      </label>
      <textarea
        id="note-body"
        name="body"
        rows={2}
        maxLength={NOTE_MAX_CHARS}
        placeholder="Visible to your team only"
        aria-invalid={bodyError ? true : undefined}
        className={bodyError ? "textarea invalid" : "textarea"}
      />
      {bodyError ? <p className="co-err" style={{ marginTop: 0 }}>{bodyError}</p> : null}
      <button type="submit" className="btn btn-sm" style={{ alignSelf: "flex-start" }} disabled={pending}>
        {pending ? "Posting…" : "Post note"}
      </button>
      <FormMessage message={state?.message} />
      <FormMessage error={state?.error} />
    </form>
  );
}

export function DeleteNoteButton({ orgId, noteId }: { orgId: string; noteId: string }) {
  const [state, action, pending] = useActionState(deleteNote, undefined);
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="noteId" value={noteId} />
      <button type="submit" disabled={pending} className="linkbtn xs" style={{ color: "var(--bad)" }}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state?.error ? <span className="xs badc" style={{ marginLeft: 8 }}>{state.error}</span> : null}
    </form>
  );
}
