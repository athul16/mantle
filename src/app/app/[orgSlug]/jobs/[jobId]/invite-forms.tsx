"use client";

import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { EXTRA_TIME_PERCENTS, type Accommodations } from "@/lib/accommodations";
import { resendInviteAction, revokeInviteAction, setAccommodationsAction } from "../actions";

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

/**
 * Extra time and monitoring waivers for one invite (D9). Only offered until
 * the candidate starts; the database refuses changes after that and audits
 * every change.
 */
export function AccommodationsForm({
  orgId,
  inviteId,
  email,
  current,
  camera,
  screen,
}: {
  orgId: string;
  inviteId: string;
  email: string;
  current: Accommodations;
  /** Whether the assessment uses the camera / screen share (a waiver only matters then). */
  camera: boolean;
  screen: boolean;
}) {
  const [state, action, pending] = useActionState(setAccommodationsAction, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="inviteId" value={inviteId} />
      <div>
        <label className="label" htmlFor={`acc-time-${inviteId}`}>
          Extra time for {email}
        </label>
        <select id={`acc-time-${inviteId}`} name="extraTimePercent" className="select" style={{ width: 160 }} defaultValue={String(current.extraTimePercent)}>
          {EXTRA_TIME_PERCENTS.map((p) => (
            <option key={p} value={p}>
              {p === 0 ? "None" : `+${p}%`}
            </option>
          ))}
        </select>
      </div>
      {camera ? (
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" className="chk" name="waiveCamera" defaultChecked={current.waiveCamera} />
          No camera for this candidate
        </label>
      ) : null}
      {screen ? (
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" className="chk" name="waiveScreen" defaultChecked={current.waiveScreen} />
          No screen share for this candidate
        </label>
      ) : null}
      <p className="xs muted">Applies only to this candidate and can change until they start. Each change is recorded in the audit log.</p>
      <FormMessage error={state?.error} message={state?.message} />
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save accommodations"}
        </Button>
      </div>
    </form>
  );
}
