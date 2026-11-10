"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { AuthorizationError, requireMembership } from "@/lib/auth";
import { parseRetentionDays } from "@/lib/retention/policy";
import { createClient } from "@/lib/supabase/server";

// Org settings (docs/02 Compliance). Admins only: the role is checked here and
// again by set_retention_days, which runs through the admin's own client and
// writes the audit row.

export async function updateRetention(_state: FormState, formData: FormData): Promise<FormState> {
  const orgId = z.uuid().safeParse(formData.get("orgId"));
  if (!orgId.success) return { error: "Missing form fields." };
  const parsed = parseRetentionDays(formData.get("retentionDays"));
  if (!parsed.ok) return { fieldErrors: { retentionDays: [parsed.error] } };

  try {
    await requireMembership(orgId.data, ["admin"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    throw err;
  }

  const db = await createClient();
  const { error } = await db.rpc("set_retention_days", { p_org_id: orgId.data, p_days: parsed.days });
  if (error) return { error: error.code === "42501" ? "You don't have permission to do that." : "Could not save the setting." };

  revalidatePath("/app/[orgSlug]/settings", "page");
  return { message: `Saved. Candidate data is kept for ${parsed.days} days.` };
}
