"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { AuthorizationError, requireMembership, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Confirm or clear an integrity flag (docs/02, docs/03). The role is checked
// here, then the write goes through the member's own client so RLS and the
// column grants check it again: only status, review_note, reviewed_by and
// reviewed_at can change. Every decision is written to the audit log.

const REVIEWERS: readonly Role[] = ["admin", "recruiter"];
const FLAG_NOTE_MAX = 2000;

const reviewFlagSchema = z.object({
  orgId: z.uuid(),
  flagId: z.uuid(),
  decision: z.enum(["confirmed", "cleared"]),
  note: z
    .string()
    .trim()
    .min(1, { error: "Add a short note explaining the decision." })
    .max(FLAG_NOTE_MAX, { error: `Keep the note under ${FLAG_NOTE_MAX} characters.` }),
});

export async function reviewFlag(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = reviewFlagSchema.safeParse({
    orgId: formData.get("orgId"),
    flagId: formData.get("flagId"),
    decision: formData.get("decision"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    if (fieldErrors.note) return { fieldErrors: { note: fieldErrors.note } };
    return { error: "Missing form fields." };
  }
  const { orgId, flagId, decision, note } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await requireMembership(orgId, REVIEWERS));
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    throw err;
  }

  const db = await createClient();
  const { data, error } = await db
    .from("flags")
    .update({ status: decision, review_note: note, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", flagId)
    .select("id");
  if (error) return { error: error.code === "42501" ? "You don't have permission to do that." : "Could not save the decision." };
  if (!data.length) return { error: "That flag no longer exists." };

  await db.from("audit_log").insert({ org_id: orgId, actor_id: userId, action: `${decision === "cleared" ? "cleared" : "confirmed"}_flag`, target: flagId });

  revalidatePath("/app/[orgSlug]/candidates", "layout");
  return { message: decision === "cleared" ? "Flag cleared." : "Flag confirmed." };
}
