"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { ROLES_FOR_UI, type UiRole } from "./roles";
import { changeRole, inviteTeammate, removeMember } from "./actions";

const selectClass = "rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

export function InviteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(inviteTeammate, undefined);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">Invite a teammate</h2>
      <input type="hidden" name="orgId" value={orgId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Email" name="email" type="email" required error={state?.fieldErrors?.email?.[0]} />
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Role</span>
          <select name="role" defaultValue="recruiter" className={`${selectClass} block`}>
            {ROLES_FOR_UI.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>{pending ? "Inviting…" : "Send invite"}</Button>
      </div>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}

export function MemberControls({ orgId, userId, role, isSelf }: { orgId: string; userId: string; role: UiRole; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, undefined);
  const [removeState, removeAction, removePending] = useActionState(removeMember, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {/* Remount after each attempt so a rejected change snaps back to the saved role. */}
        <form action={roleAction} key={JSON.stringify(roleState ?? null)}>
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="userId" value={userId} />
          <select
            name="role"
            defaultValue={role}
            disabled={rolePending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label="Role"
            className={selectClass}
          >
            {ROLES_FOR_UI.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </form>
        <form
          action={removeAction}
          onSubmit={(e) => {
            if (!confirm(isSelf ? "Remove yourself from this company? You'll lose access." : "Remove this person from the company?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" variant="danger" disabled={removePending} className="px-3 py-1.5">
            {isSelf ? "Leave" : "Remove"}
          </Button>
        </form>
      </div>
      {roleState?.error ? <p className="text-xs text-red-600">{roleState.error}</p> : null}
      {removeState?.error ? <p className="text-xs text-red-600">{removeState.error}</p> : null}
    </div>
  );
}
