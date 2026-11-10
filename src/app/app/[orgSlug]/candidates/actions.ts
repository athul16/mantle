"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { AuthorizationError, requireMembership, type Role } from "@/lib/auth";
import { addNoteSchema, deleteNoteSchema, parseRubricForm } from "@/lib/results/schemas";
import { createClient } from "@/lib/supabase/server";

// Candidate report actions. Each one (1) checks the caller's role on the
// server, then (2) writes with the caller's own client so RLS (or the
// review_rubric_step function's own role check) checks it again.

const REVIEWERS: readonly Role[] = ["admin", "recruiter"];

function refresh() {
  revalidatePath("/app/[orgSlug]/candidates", "layout");
}

function fail(err: unknown): FormState {
  if (err instanceof AuthorizationError) return { error: err.message };
  throw err;
}

/** Rubric points for a step that needs review; the attempt's final score is recomputed. Admins and recruiters only. */
export async function reviewRubricStep(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseRubricForm(formData);
  if (!parsed.ok) return parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : { error: parsed.error };
  const { orgId, attemptId, stepId, scores } = parsed;

  try {
    await requireMembership(orgId, REVIEWERS);
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  const { error } = await db.rpc("review_rubric_step", { p_attempt_id: attemptId, p_step_id: stepId, p_scores: scores });
  if (error) {
    if (error.code === "42501") return { error: "You don't have permission to do that." };
    if (error.code === "22023") return { error: `Could not save the review: ${error.message}.` };
    return { error: "Could not save the review." };
  }

  refresh();
  return { message: "Review saved. The final score is updated." };
}

/** A note and/or hire vote. Every member, viewers included (docs/03). */
export async function addNote(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = addNoteSchema.safeParse({
    orgId: formData.get("orgId"),
    attemptId: formData.get("attemptId"),
    body: formData.get("body") ?? "",
    vote: formData.get("vote") ?? "",
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { orgId, attemptId, body, vote } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await requireMembership(orgId));
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  const { error } = await db.from("notes").insert({ org_id: orgId, attempt_id: attemptId, author_id: userId, body, vote });
  if (error) return { error: "Could not save the note." };

  refresh();
  return { message: "Note added." };
}

/** Authors delete their own notes only (RLS enforces it too). */
export async function deleteNote(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = deleteNoteSchema.safeParse({ orgId: formData.get("orgId"), noteId: formData.get("noteId") });
  if (!parsed.success) return { error: "Missing form fields." };
  const { orgId, noteId } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await requireMembership(orgId));
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  const { data, error } = await db.from("notes").delete().eq("org_id", orgId).eq("id", noteId).eq("author_id", userId).select("id");
  if (error || !data?.length) return { error: "Could not delete the note." };

  refresh();
  return { message: "Note deleted." };
}
