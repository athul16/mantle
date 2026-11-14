"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { resendInviteAction, revokeInviteAction } from "../actions";

// The invite form lives with its page (invite/invite-candidates-form.tsx);
// re-exported here so existing imports keep working.
export { InviteCandidatesForm, type InviteSummary } from "./invite/invite-candidates-form";

/** Resend and revoke for one invite row (used on the job's candidate list). */
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
  const note = resendState?.error ?? revokeState?.error ?? revokeState?.message ?? resendState?.message;
  const failed = Boolean(resendState?.error || revokeState?.error);

  // Once an invite is revoked it can't be resent or revoked, but the component
  // stays mounted so the "Revoked …" confirmation is still shown.
  if (!canResend && !canRevoke && !note) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {canResend || canRevoke ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          {canResend ? (
            <form
              action={resend}
              onSubmit={(e) => {
                if (!confirm(`Send ${email} a new link? Their current link will stop working.`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="inviteId" value={inviteId} />
              <Button type="submit" variant="secondary" size="sm" disabled={resending}>
                {resending ? "Sending…" : "Resend link"}
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
              <Button type="submit" variant="danger" size="sm" disabled={revoking}>
                {revoking ? "Revoking…" : "Revoke"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {note ? <p className={`xs ${failed ? "badc" : "okc"}`}>{note}</p> : null}
    </div>
  );
}
