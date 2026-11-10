"use client";

import Link from "next/link";
import type { Membership } from "@/lib/auth";
import { switchOrg } from "./actions";

export function OrgSwitcher({ memberships, activeOrgId }: { memberships: Membership[]; activeOrgId: string }) {
  return (
    <>
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
      {/* Two-factor setup for the signed-in user (src/app/app/account/security). */}
      <Link href="/app/account/security" className="text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
        Security
      </Link>
    </>
  );
}
