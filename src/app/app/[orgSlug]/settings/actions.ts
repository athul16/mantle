"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { AuthorizationError, requireMembership } from "@/lib/auth";
import { parseRetention } from "@/lib/retention/policy";
import { createClient } from "@/lib/supabase/server";

// Org settings (docs/02 Compliance). Admins only: the role is checked here and
// again by set_retention, which runs through the admin's own client and
// writes the audit row.

export async function updateRetention(_state: FormState, formData: FormData): Promise<FormState> {
  const orgId = z.uuid().safeParse(formData.get("orgId"));
  if (!orgId.success) return { error: "Missing form fields." };
  const parsed = parseRetention(formData.get("mediaRetentionDays"), formData.get("resultsRetentionDays"));
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };

  try {
    await requireMembership(orgId.data, ["admin"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    throw err;
  }

  const db = await createClient();
  const { error } = await db.rpc("set_retention", {
    p_org_id: orgId.data,
    p_media_days: parsed.mediaDays,
    p_results_days: parsed.resultsDays,
  });
  if (error) return { error: error.code === "42501" ? "You don't have permission to do that." : "Could not save the setting." };

  revalidatePath("/app/[orgSlug]/settings", "page");
  return { message: `Saved. Photos and screenshots are kept for ${parsed.mediaDays} days, results for ${parsed.resultsDays} days.` };
}
