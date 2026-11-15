"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import type { ExtraTimePercent } from "@/lib/accommodations";
import { AuthorizationError, requireMembership, type Role } from "@/lib/auth";
import { MAX_CSV_BYTES, MAX_INVITES_PER_BATCH, mergeRecipients, parseCsvEmails, parsePastedEmails } from "@/lib/jobs/emails";
import { InviteError, createInvites, resendInvite, revokeInvite, setAccommodations } from "@/lib/jobs/invites";
import {
  accommodationsSchema,
  cloneAssessmentSchema,
  createAssessmentSchema,
  createJobSchema,
  inviteActionSchema,
  inviteBatchSchema,
  updateAssessmentSchema,
} from "@/lib/jobs/schemas";
import { createClient } from "@/lib/supabase/server";

// Every action: (1) check on the server that the caller is an admin or
// recruiter of the org, (2) write with the caller's own client so RLS checks
// it again. Only invite_secrets is written with the service client (inside
// src/lib/jobs/invites.ts).

const MANAGERS: readonly Role[] = ["admin", "recruiter"];
const LOCKED_TRIGGER = "assessment is locked";

function fail(err: unknown): FormState {
  if (err instanceof AuthorizationError || err instanceof InviteError) return { error: err.message };
  throw err;
}

function fields(formData: FormData) {
  const out: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of formData) if (typeof value === "string") out[key] = value;
  return out;
}

function refreshJobs() {
  revalidatePath("/app/[orgSlug]/jobs", "layout");
}

export async function createAssessment(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = createAssessmentSchema.safeParse(fields(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { orgId, scenarioId, title, timeLimitMinutes, passScore, camera, screen } = parsed.data;

  try {
    await requireMembership(orgId, MANAGERS);
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  // Library scenarios (published, no org) or the company's own published ones.
  const { data: scenario } = await db
    .from("scenarios")
    .select("id, org_id")
    .eq("id", scenarioId)
    .not("published_at", "is", null)
    .maybeSingle();
  if (!scenario || (scenario.org_id !== null && scenario.org_id !== orgId)) {
    return { fieldErrors: { scenarioId: ["Pick a published scenario."] } };
  }

  const { error } = await db.from("assessments").insert({
    org_id: orgId,
    scenario_id: scenarioId,
    title,
    time_limit_minutes: timeLimitMinutes,
    pass_score: passScore ?? null,
    proctoring: { camera, screen },
  });
  if (error) return { error: "Could not create the assessment." };

  refreshJobs();
  return { message: `Created "${title}".` };
}

export async function updateAssessment(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = updateAssessmentSchema.safeParse(fields(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { orgId, assessmentId, title, timeLimitMinutes, passScore, camera, screen } = parsed.data;

  try {
    await requireMembership(orgId, MANAGERS);
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  const { data, error } = await db
    .from("assessments")
    .update({ title, time_limit_minutes: timeLimitMinutes, pass_score: passScore ?? null, proctoring: { camera, screen } })
    .eq("id", assessmentId)
    .eq("org_id", orgId)
    .select("id");
  if (error) {
    if (error.message.includes(LOCKED_TRIGGER)) {
      return { error: "A candidate has started this assessment, so its settings are locked. Clone it to change them." };
    }
    return { error: "Could not save the assessment." };
  }
  if (data.length !== 1) return { error: "That assessment doesn't exist." };

  refreshJobs();
  return { message: "Saved." };
}

export async function cloneAssessment(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = cloneAssessmentSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, assessmentId } = parsed.data;

  try {
    await requireMembership(orgId, MANAGERS);
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  const { data: source } = await db
    .from("assessments")
    .select("scenario_id, title, time_limit_minutes, pass_score, proctoring")
    .eq("id", assessmentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!source) return { error: "That assessment doesn't exist." };

  const title = `${source.title} (copy)`.slice(0, 200);
  const { error } = await db.from("assessments").insert({ ...source, title, org_id: orgId });
  if (error) return { error: "Could not clone the assessment." };

  refreshJobs();
  return { message: `Created "${title}". Edit it before linking it to a job.` };
}

export async function createJob(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = createJobSchema.safeParse(fields(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { orgId, title, assessmentId, deadline } = parsed.data;

  try {
    await requireMembership(orgId, MANAGERS);
  } catch (err) {
    return fail(err);
  }

  const db = await createClient();
  const { error } = await db.from("jobs").insert({ org_id: orgId, title, assessment_id: assessmentId, deadline });
  if (error) {
    // 23503: the assessment isn't in this company (composite foreign key).
    if (error.code === "23503") return { fieldErrors: { assessmentId: ["Pick one of your assessments."] } };
    return { error: "Could not create the job." };
  }

  refreshJobs();
  return { message: `Created "${title}". Open it to invite candidates.` };
}

export type InviteBatchState =
  | (NonNullable<FormState> & {
      invited?: string[];
      alreadyInvited?: string[];
      invalid?: string[];
      duplicates?: string[];
      failedToSend?: string[];
      /** The pasted text, echoed back when the batch is rejected. */
      emails?: string;
    })
  | undefined;

export async function inviteCandidates(_state: InviteBatchState, formData: FormData): Promise<InviteBatchState> {
  const parsed = inviteBatchSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, jobId, emails } = parsed.data;

  let membership;
  try {
    membership = await requireMembership(orgId, MANAGERS);
  } catch (err) {
    return fail(err);
  }
  const rejected = (error: string, extra?: Partial<NonNullable<InviteBatchState>>): InviteBatchState => ({ error, emails, ...extra });

  const parts = [parsePastedEmails(emails)];
  const file = formData.get("csv");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) return rejected("That CSV is too large. Split it into smaller files.");
    parts.push(parseCsvEmails(await file.text()));
  }
  const { recipients, invalid, duplicates } = mergeRecipients(...parts);

  if (invalid.length > 0) {
    return rejected(`Fix ${invalid.length === 1 ? "this entry" : `these ${invalid.length} entries`} and try again. Nothing was sent.`, { invalid });
  }
  if (recipients.length === 0) return rejected("Paste at least one email or upload a CSV.");
  if (recipients.length > MAX_INVITES_PER_BATCH) {
    return rejected(`That's ${recipients.length} candidates. Invite at most ${MAX_INVITES_PER_BATCH} at a time. Nothing was sent.`);
  }

  let result;
  try {
    result = await createInvites({
      db: await createClient(),
      orgId,
      orgName: membership.orgName,
      jobId,
      recipients,
      createdBy: membership.userId,
    });
  } catch (err) {
    const state = fail(err);
    return state?.error ? rejected(state.error) : state;
  }

  refreshJobs();
  const sent = result.invited.length - result.failedToSend.length;
  const summary = [`Invited ${sent} candidate${sent === 1 ? "" : "s"}.`];
  if (result.alreadyInvited.length) summary.push(`Skipped ${result.alreadyInvited.length} already invited.`);
  if (duplicates.length) summary.push(`Removed ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}.`);
  return {
    message: summary.join(" "),
    error: result.failedToSend.length
      ? `The email to ${result.failedToSend.length} candidate${result.failedToSend.length === 1 ? "" : "s"} failed. Use Resend on their rows.`
      : undefined,
    ...result,
    duplicates,
  };
}

export async function resendInviteAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = inviteActionSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, inviteId } = parsed.data;

  try {
    const membership = await requireMembership(orgId, MANAGERS);
    const { email } = await resendInvite({ db: await createClient(), orgId, orgName: membership.orgName, inviteId });
    refreshJobs();
    return { message: `New link sent to ${email}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function setAccommodationsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = accommodationsSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, inviteId, extraTimePercent, waiveCamera, waiveScreen } = parsed.data;

  try {
    await requireMembership(orgId, MANAGERS);
    const { email } = await setAccommodations({
      db: await createClient(),
      orgId,
      inviteId,
      accommodations: { extraTimePercent: extraTimePercent as ExtraTimePercent, waiveCamera, waiveScreen },
    });
    refreshJobs();
    return { message: `Saved accommodations for ${email}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeInviteAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = inviteActionSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, inviteId } = parsed.data;

  try {
    await requireMembership(orgId, MANAGERS);
    const { email } = await revokeInvite({ db: await createClient(), orgId, inviteId });
    refreshJobs();
    return { message: `Revoked ${email}'s invite.` };
  } catch (err) {
    return fail(err);
  }
}
