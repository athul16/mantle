"use client";

import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { inviteCandidates, resendInviteAction, revokeInviteAction } from "../actions";

export function InviteCandidatesForm({ orgId, jobId, max }: { orgId: string; jobId: string; max: number }) {
  const [state, action, pending] = useActionState(inviteCandidates, undefined);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">Invite candidates</h2>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="jobId" value={jobId} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Paste emails</span>
        <textarea
          name="emails"
          rows={4}
          // React resets the form after each submit; put back what was typed
          // when the batch was rejected.
          key={JSON.stringify(state ?? null)}
          defaultValue={state?.emails ?? ""}
          placeholder={"jane@example.com\nsam@example.com"}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">or upload a CSV</span>
        <input type="file" name="csv" accept=".csv,text/csv,text/plain" className="block text-sm" />
        <span className="block text-xs text-neutral-500">
          Uses the &quot;email&quot; column (and &quot;name&quot; if present); without a header, the first cell with an @ in each row.
        </span>
      </label>
      <p className="text-xs text-neutral-500">Up to {max} candidates per batch. Duplicates and people already invited to this job are skipped.</p>
      <Button type="submit" disabled={pending}>{pending ? "Sending invites…" : "Send invites"}</Button>
      <FormMessage message={state?.message} />
      <FormMessage error={state?.error} />
      {state?.invalid?.length ? (
        <ul className="list-inside list-disc text-sm text-red-700 dark:text-red-400">
          {state.invalid.slice(0, 20).map((e, n) => (
            <li key={`${e}-${n}`}>{e}</li>
          ))}
          {state.invalid.length > 20 ? <li>…and {state.invalid.length - 20} more</li> : null}
        </ul>
      ) : null}
      {state?.failedToSend?.length ? (
        <p className="text-sm text-red-700 dark:text-red-400">Not delivered: {state.failedToSend.join(", ")}</p>
      ) : null}
    </form>
  );
}

export function InviteRowActions({
  orgId,
  inviteId,
  email,
  canResend,
  canRevoke,
}: {
  orgId: string;
  inviteId: string;
  email: string;
  canResend: boolean;
  canRevoke: boolean;
}) {
  const [resendState, resend, resending] = useActionState(resendInviteAction, undefined);
  const [revokeState, revoke, revoking] = useActionState(revokeInviteAction, undefined);
  const note = resendState?.error ?? revokeState?.error ?? resendState?.message;

  if (!canResend && !canRevoke) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-2">
        {canResend ? (
          <form
            action={resend}
            onSubmit={(e) => {
              if (!confirm(`Send ${email} a new link? Their current link will stop working.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="inviteId" value={inviteId} />
            <Button type="submit" variant="secondary" disabled={resending} className="px-3 py-1">
              {resending ? "Sending…" : "Resend"}
            </Button>
          </form>
        ) : null}
        {canRevoke ? (
          <form
            action={revoke}
            onSubmit={(e) => {
              if (!confirm(`Revoke ${email}'s invite? Their link will stop working.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="inviteId" value={inviteId} />
            <Button type="submit" variant="danger" disabled={revoking} className="px-3 py-1">
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          </form>
        ) : null}
      </div>
      {note ? <p className={`text-xs ${resendState?.error || revokeState?.error ? "text-red-600" : "text-green-700"}`}>{note}</p> : null}
    </div>
  );
}
