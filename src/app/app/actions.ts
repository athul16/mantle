"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE, requireMembership } from "@/lib/auth";
import { activeOrgCookieOptions } from "@/lib/active-org-cookie";

export async function switchOrg(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  // Only store an org the user really belongs to.
  await requireMembership(orgId);
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, activeOrgCookieOptions);
  redirect("/app");
}
