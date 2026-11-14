"use client";

import { useActionState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Button, FormMessage } from "@/components/ui";
import { ROLES_FOR_UI, type UiRole } from "./roles";
import { changeRole, inviteTeammate, removeMember } from "./actions";

// One line per role for the explainer under the invite form (prototype copy).
const ROLE_NOTES: Record<UiRole, string> = {
  admin: "Billing, teammates, company-wide settings. Must use two-factor.",
  recruiter: "Runs hiring rounds: invites, reviews, advances",
  viewer: "Reads results, adds notes and votes",
};

export function InviteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(inviteTeammate, undefined);
  return (
    <form action={action} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontFamily: "var(--font)", fontSize: 15, fontWeight: 600, letterSpacing: 0 }}>Invite a teammate</h2>
      <input type="hidden" name="orgId" value={orgId} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 320px" }}>
          <label className="label" htmlFor="tm-email">Email</label>
          <input
            id="tm-email"
            className={state?.fieldErrors?.email ? "input invalid" : "input"}
            name="email"
            type="email"
            required
            placeholder="name@company.com"
            aria-invalid={state?.fieldErrors?.email ? true : undefined}
            aria-describedby={state?.fieldErrors?.email ? "tm-email-error" : undefined}
          />
        </div>
        <div style={{ flex: "0 1 200px" }}>
          <label className="label" htmlFor="tm-role">Role</label>
          <select id="tm-role" name="role" defaultValue="recruiter" className="select">
            {ROLES_FOR_UI.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          <Icon name="send" />
          {pending ? "Inviting…" : "Send invite"}
        </Button>
      </div>
      {state?.fieldErrors?.email?.[0] ? (
        <p id="tm-email-error" className="co-err" style={{ marginTop: -6 }}>
          <Icon name="alert" className="i-sm" />
          {state.fieldErrors.email[0]}
        </p>
      ) : null}
      <FormMessage error={state?.error} message={state?.message} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8, fontSize: 12 }}>
        {ROLES_FOR_UI.map((r) => (
          <div key={r.value} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--subtle)" }}>
            <div className="strong">{r.label}</div>
            <div className="muted">{ROLE_NOTES[r.value]}</div>
          </div>
        ))}
      </div>
    </form>
  );
}

export function TwoFactor({ pending, on }: { pending: boolean; on: boolean }) {
  if (pending) return <span className="muted">—</span>;
  return on ? <span className="badge b-ok">On</span> : <span className="badge">Off</span>;
}

/** The role, two-factor and actions cells of an admin's team table row. */
export function MemberControls({
  orgId,
  userId,
  email,
  role,
  isSelf,
  pending,
  twoFactor,
}: {
  orgId: string;
  userId: string;
  email: string;
  role: UiRole;
  isSelf: boolean;
  pending: boolean;
  twoFactor: ReactNode;
}) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, undefined);
  const [removeState, removeAction, removePending] = useActionState(removeMember, undefined);
  const label = isSelf ? "Leave" : pending ? "Cancel" : "Remove";
  const question = isSelf
    ? "Remove yourself from this company? You'll lose access."
    : pending
      ? `Cancel the invite to ${email}?`
      : "Remove this person from the company?";

  return (
    <>
      <td>
        {/* Remount after each attempt so a rejected change snaps back to the saved role. */}
        <form action={roleAction} key={JSON.stringify(roleState ?? null)}>
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="userId" value={userId} />
          <select
            name="role"
            defaultValue={role}
            disabled={rolePending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label={`Role for ${email}`}
            className="select"
            style={{ width: 150, height: 32, fontSize: 13 }}
          >
            {ROLES_FOR_UI.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </form>
        {roleState?.error ? <p className="co-err xs" style={{ maxWidth: 260 }}>{roleState.error}</p> : null}
      </td>
      <td>{twoFactor}</td>
      <td className="r">
        <form
          action={removeAction}
          onSubmit={(e) => {
            if (!confirm(question)) e.preventDefault();
          }}
        >
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" variant="ghost" size="sm" disabled={removePending} className={isSelf ? "" : "btn-danger"}>
            {label}
          </Button>
        </form>
        {removeState?.error ? <p className="co-err xs" style={{ justifyContent: "flex-end", maxWidth: 280, marginLeft: "auto" }}>{removeState.error}</p> : null}
      </td>
    </>
  );
}
