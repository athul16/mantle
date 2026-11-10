"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { AuthorizationError, requireMembership } from "@/lib/auth";
import { deleteCandidateData } from "@/lib/retention/delete";
import { createClient } from "@/lib/supabase/server";

// "Delete candidate data" on the report (docs/02 Compliance): admins only,
// after typing "delete". Removes every row about the candidate and their
// snapshot files, then returns to the job's candidate list.

const DELETE_CONFIRM_WORD = "delete";

const schema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  inviteId: z.uuid(),
  jobId: z.uuid(),
  confirm: z.string(),
});

export async function deleteCandidate(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = schema.safeParse(Object.fromEntries(["orgId", "orgSlug", "inviteId", "jobId", "confirm"].map((k) => [k, formData.get(k) ?? ""])));
  if (!parsed.success) return { error: "Missing form fields." };
  const { orgId, orgSlug, inviteId, jobId, confirm } = parsed.data;
  if (confirm.trim().toLowerCase() !== DELETE_CONFIRM_WORD) return { error: `Type "${DELETE_CONFIRM_WORD}" to confirm.` };

  try {
    await requireMembership(orgId, ["admin"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    throw err;
  }

  const result = await deleteCandidateData(await createClient(), orgId, inviteId);
  if (!result.ok) return { error: result.error === "forbidden" ? "You don't have permission to do that." : "Could not delete the candidate's data." };

  revalidatePath("/app/[orgSlug]/candidates", "page");
  redirect(`/app/${orgSlug}/candidates?job=${jobId}`);
}
