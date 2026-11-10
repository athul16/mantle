"use client";

import { useActionState, useState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { deleteCandidate } from "./delete-candidate-action";

const CONFIRM = "delete";

/** Admin-only "Delete candidate data" with a typed confirmation. Renders nothing for other roles. */
export function DeleteCandidateData({
  role,
  orgId,
  orgSlug,
  inviteId,
  jobId,
}: {
  role: string;
  orgId: string;
  orgSlug: string;
  inviteId: string;
  jobId: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteCandidate, undefined);
  if (role !== "admin") return null;

  return (
    <section aria-labelledby="delete-heading" className="space-y-3 rounded-lg border border-red-200 p-4 dark:border-red-900">
      <h2 id="delete-heading" className="text-lg font-medium">Delete candidate data</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Permanently deletes this candidate&apos;s invite, answers, scores, notes, integrity flags and proctoring snapshots.
        This can&apos;t be undone. The audit log keeps only that a deletion happened.
      </p>
      {open ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="inviteId" value={inviteId} />
          <input type="hidden" name="jobId" value={jobId} />
          <label className="block space-y-1 sm:w-64">
            <span className="text-sm font-medium">Type &quot;{CONFIRM}&quot; to confirm</span>
            <input
              name="confirm"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending || typed.trim().toLowerCase() !== CONFIRM}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setOpen(false); setTyped(""); }} disabled={pending}>
              Cancel
            </Button>
          </div>
          <FormMessage error={state?.error} />
        </form>
      ) : (
        <Button type="button" variant="danger" onClick={() => setOpen(true)}>Delete candidate data</Button>
      )}
    </section>
  );
}
