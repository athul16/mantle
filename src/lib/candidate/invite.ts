import "server-only";

import { effectiveTimeLimitMinutes, readAccommodations, type Accommodations } from "@/lib/accommodations";
import { readContactEmail } from "@/lib/org-settings";
import { hashToken } from "@/lib/tokens";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Invite lookups for the candidate flow. Everything here is read-only: opening
 * the invite link must never use anything up (decision Q3, Microsoft Safe
 * Links pre-opens links). Writes happen only on an explicit POST.
 */

export interface InviteContext {
  inviteId: string;
  orgId: string;
  email: string;
  candidateName: string | null;
  status: "invited" | "started" | "completed" | "expired" | "revoked";
  /** Last moment the candidate may start: the earlier of the invite expiry and the job deadline. */
  startBy: Date;
  companyName: string;
  /** Whom to ask about accommodations (organizations.settings.contact_email), if the company set one. */
  contactEmail: string | null;
  jobTitle: string;
  assessmentId: string;
  scenarioId: string;
  /** This candidate's limit: the assessment's, plus any extra time (D9). The deadline is set from this. */
  timeLimitMinutes: number;
  /** The assessment's own limit, before extra time. */
  baseTimeLimitMinutes: number;
  accommodations: Accommodations;
}

export interface AttemptRow {
  id: string;
  org_id: string;
  invite_id: string;
  scenario_id: string;
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  submit_reason: string | null;
  status: "not_started" | "in_progress" | "submitted" | "scored";
}

export const ATTEMPT_COLUMNS =
  "id, org_id, invite_id, scenario_id, started_at, deadline_at, submitted_at, submit_reason, status" as const;

/** Token shape from generateToken(): 32 bytes base64url. Reject anything else before hashing. */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,100}$/.test(token);
}

/** The invite a raw link token belongs to, or null. Reads only. */
export async function findInviteByToken(token: string): Promise<InviteContext | null> {
  if (!looksLikeToken(token)) return null;
  const db = createServiceClient();

  const { data: secret, error: secretError } = await db
    .from("invite_secrets")
    .select("invite_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (secretError) throw new Error(`invite lookup failed: ${secretError.message}`);
  if (!secret) return null;
  return loadInvite(secret.invite_id);
}

/** Full invite context by id (the id must come from a verified token or session). */
export async function loadInvite(inviteId: string): Promise<InviteContext | null> {
  const db = createServiceClient();
  const { data: invite, error } = await db
    .from("invites")
    .select("id, org_id, job_id, email, candidate_name, status, expires_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (error) throw new Error(`invite lookup failed: ${error.message}`);
  if (!invite) return null;

  const [org, job, accommodation] = await Promise.all([
    db.from("organizations").select("name, settings").eq("id", invite.org_id).single(),
    db.from("jobs").select("title, deadline, assessment_id").eq("id", invite.job_id).eq("org_id", invite.org_id).single(),
    db
      .from("invite_accommodations")
      .select("extra_time_percent, waive_camera, waive_screen")
      .eq("invite_id", invite.id)
      .eq("org_id", invite.org_id)
      .maybeSingle(),
  ]);
  if (org.error) throw new Error(`organization lookup failed: ${org.error.message}`);
  if (job.error) throw new Error(`job lookup failed: ${job.error.message}`);
  if (accommodation.error) throw new Error(`accommodations lookup failed: ${accommodation.error.message}`);
  const accommodations = readAccommodations(accommodation.data);

  const assessment = await db
    .from("assessments")
    .select("id, scenario_id, time_limit_minutes")
    .eq("id", job.data.assessment_id)
    .eq("org_id", invite.org_id)
    .single();
  if (assessment.error) throw new Error(`assessment lookup failed: ${assessment.error.message}`);

  const expires = new Date(invite.expires_at);
  const jobDeadline = job.data.deadline ? new Date(job.data.deadline) : null;
  const startBy = jobDeadline && jobDeadline < expires ? jobDeadline : expires;

  return {
    inviteId: invite.id,
    orgId: invite.org_id,
    email: invite.email,
    candidateName: invite.candidate_name,
    status: invite.status as InviteContext["status"],
    startBy,
    companyName: org.data.name,
    contactEmail: readContactEmail(org.data.settings),
    jobTitle: job.data.title,
    assessmentId: assessment.data.id,
    scenarioId: assessment.data.scenario_id,
    timeLimitMinutes: effectiveTimeLimitMinutes(assessment.data.time_limit_minutes, accommodations.extraTimePercent),
    baseTimeLimitMinutes: assessment.data.time_limit_minutes,
    accommodations,
  };
}

/** The attempt for an invite, if one was created at verification. */
export async function findAttemptForInvite(inviteId: string, orgId: string): Promise<AttemptRow | null> {
  const { data, error } = await createServiceClient()
    .from("attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("invite_id", inviteId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`attempt lookup failed: ${error.message}`);
  return data as AttemptRow | null;
}

/**
 * Whether a new verification (code request or check) is allowed for this
 * invite. An invite whose attempt is already under way can always be
 * re-verified to resume, even after the start-by date.
 */
export function inviteBlockReason(
  invite: InviteContext,
  attempt: AttemptRow | null,
  now = new Date(),
): "revoked" | "expired" | "completed" | null {
  if (invite.status === "revoked") return "revoked";
  if (invite.status === "completed" || attempt?.status === "submitted" || attempt?.status === "scored") return "completed";
  if (attempt?.status === "in_progress") return null;
  if (invite.status === "expired" || now > invite.startBy) return "expired";
  return null;
}
