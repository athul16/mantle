"use client";

import type { Membership } from "@/lib/auth";
import { switchOrg } from "./actions";

export function OrgSwitcher({ memberships, activeOrgId }: { memberships: Membership[]; activeOrgId: string }) {
  return (
    <form action={switchOrg}>
      <label className="sr-only" htmlFor="org-switcher">Company</label>
      <select
        id="org-switcher"
        name="orgId"
        defaultValue={activeOrgId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
      >
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName}
          </option>
        ))}
      </select>
    </form>
  );
}
