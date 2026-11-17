import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Accommodations } from "@/lib/accommodations";
import type { Database } from "@/lib/database.types";
import { sendEmail } from "@/lib/email";
import { inviteEmailHtml } from "@/lib/email/templates";
import { createServiceClient } from "@/lib/supabase/service";
import { generateToken, hashToken } from "@/lib/tokens";
import { MAX_INVITES_PER_BATCH, type ParsedRecipient } from "./emails";
import { canResend, canRevoke, displayStatus, inviteExpiry } from "./status";

// Candidate invites. Invite rows are written with the signed-in user's client
// (`db`), so RLS checks the caller can manage this company. Only the
// invite_secrets row (token hash) is written with the service client, because
// company users can't read or write that table. Raw tokens exist only in
// memory and in the email; they're never stored or logged.

type Db = SupabaseClient<Database>;

/** Statuses covered by the unique index invites_job_email_live_key. */
const LIVE_STATUSES = ["invited", "started", "completed"];
const UNIQUE_VIOLATION = "23505";
const MAX_INSERT_RETRIES = 3;

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteError";
  }
}

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function inviteLink(token: string) {
  return `${appUrl()}/a/${token}`;
}

export function buildInviteEmail(args: {
  orgName: string;
  jobTitle: string;
  link: string;
  expiresAt: Date;
  minutes?: number;
  needsWebcam?: boolean;
  candidateName?: string | null;
}) {
  const deadline = args.expiresAt.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const completeBy = args.expiresAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const firstName = args.candidateName?.trim().split(/\s+/)[0] || null;
  const subject = `${args.orgName}: your work simulation for ${args.jobTitle}`;
  const text = [
    firstName ? `Hi ${firstName},` : `Hi,`,
    ``,
    `${args.orgName} has invited you to a short work simulation for the ${args.jobTitle} role.${args.minutes ? ` It takes ${args.minutes} minutes, timed.` : ""}`,
    ``,
    `Start here: ${args.link}`,
    ``,
    `The link is personal to you. Please finish by ${deadline} UTC. No account or download needed. Once you start, the timer runs until you submit.`,
    ``,
    `If you weren't expecting this email, you can ignore it.`,
  ].join("\n");
  const html = inviteEmailHtml({
    orgName: args.orgName,
    jobTitle: args.jobTitle,
    link: args.link,
    completeBy,
    minutes: args.minutes,
    needsWebcam: args.needsWebcam,
    firstName,
  });
  return { subject, text, html };
}

/** Sends one email, retrying once after a short pause (provider rate limits). */
async function sendWithRetry(message: Parameters<typeof sendEmail>[0]) {
  try {
    await sendEmail(message);
  } catch {
    await new Promise((r) => setTimeout(r, 1100));
    await sendEmail(message);
  }
}

async function loadJob(db: Db, orgId: string, jobId: string) {
  const { data, error } = await db
    .from("jobs")
    .select("id, title, deadline, assessments(time_limit_minutes, proctoring)")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new InviteError("That job doesn't exist.");
  const assessment = Array.isArray(data.assessments) ? data.assessments[0] : data.assessments;
  const proctoring = (assessment?.proctoring ?? {}) as { camera?: unknown };
  return {
    id: data.id,
    title: data.title,
    deadline: data.deadline,
    emailDetails: { minutes: assessment?.time_limit_minutes ?? undefined, needsWebcam: proctoring.camera === true },
  };
}

export type InviteBatchResult = {
  invited: string[];
  alreadyInvited: string[];
  failedToSend: string[];
};

/**
 * Creates one invite per recipient for a job and emails each a link. Emails
 * that already have a live invite (invited, started or completed) for this job
 * are skipped. Throws InviteError for problems the user can fix.
 */
export async function createInvites(args: {
  db: Db;
  orgId: string;
  orgName: string;
  jobId: string;
  recipients: ParsedRecipient[];
  createdBy: string;
}): Promise<InviteBatchResult> {
  const { db, orgId, orgName, jobId, createdBy } = args;
  const job = await loadJob(db, orgId, jobId);
  const expiresAt = inviteExpiry(job.deadline);
  if (expiresAt.getTime() <= Date.now()) {
    throw new InviteError("This job's invite deadline has passed.");
  }

  // Invites still marked "invited" after their expiry are shown as expired;
  // mark the rows too, so they leave the unique index and can be re-invited (J3).
  const { error: expireError } = await db
    .from("invites")
    .update({ status: "expired" })
    .eq("org_id", orgId)
    .eq("job_id", jobId)
    .eq("status", "invited")
    .lte("expires_at", new Date().toISOString());
  if (expireError) throw expireError;

  // The app check skips emails that already have a live invite. Another batch
  // can insert one of them between the check and the insert; the unique index
  // invites_job_email_live_key then rejects the whole insert (23505), nothing
  // is written, and the check runs again with the new rows.
  let alreadyInvited: string[] = [];
  let rows: { id: string; email: string; candidate_name: string | null }[] = [];
  for (let attempt = 0; ; attempt++) {
    const { data: existing, error: existingError } = await db
      .from("invites")
      .select("email")
      .eq("org_id", orgId)
      .eq("job_id", jobId)
      .in("status", LIVE_STATUSES);
    if (existingError) throw existingError;
    const live = new Set(existing.map((r) => r.email.toLowerCase()));

    alreadyInvited = args.recipients.filter((r) => live.has(r.email)).map((r) => r.email);
    const fresh = args.recipients.filter((r) => !live.has(r.email));
    if (fresh.length > MAX_INVITES_PER_BATCH) {
      throw new InviteError(`That's ${fresh.length} new candidates. Invite at most ${MAX_INVITES_PER_BATCH} at a time.`);
    }
    if (fresh.length === 0) return { invited: [], alreadyInvited, failedToSend: [] };

    const { data, error: insertError } = await db
      .from("invites")
      .insert(
        fresh.map((r) => ({
          org_id: orgId,
          job_id: jobId,
          email: r.email,
          candidate_name: r.name,
          expires_at: expiresAt.toISOString(),
          created_by: createdBy,
        })),
      )
      .select("id, email, candidate_name");
    if (!insertError) {
      rows = data;
      break;
    }
    if (insertError.code !== UNIQUE_VIOLATION || attempt >= MAX_INSERT_RETRIES) {
      if (insertError.code === UNIQUE_VIOLATION) {
        throw new InviteError("Another invite for some of these candidates was sent at the same time. Nothing was sent; try again.");
      }
      throw insertError;
    }
  }
  const names = new Map(rows.map((row) => [row.id, row.candidate_name]));

  const tokens = new Map(rows.map((row) => [row.id, generateToken()]));
  const service = createServiceClient();
  const { error: secretError } = await service
    .from("invite_secrets")
    .insert(rows.map((row) => ({ invite_id: row.id, org_id: orgId, token_hash: hashToken(tokens.get(row.id)!) })));
  if (secretError) {
    // Without a token hash the invites are useless; undo them.
    await db.from("invites").delete().in("id", rows.map((r) => r.id)).eq("org_id", orgId);
    throw secretError;
  }

  const failedToSend: string[] = [];
  for (const row of rows) {
    const email = buildInviteEmail({ orgName, jobTitle: job.title, link: inviteLink(tokens.get(row.id)!), expiresAt, ...job.emailDetails, candidateName: names.get(row.id) });
    try {
      await sendWithRetry({ to: row.email, ...email });
    } catch (err) {
      console.error("invite email failed", { inviteId: row.id, message: err instanceof Error ? err.message : String(err) });
      failedToSend.push(row.email);
    }
  }
  tokens.clear();

  return { invited: rows.map((r) => r.email), alreadyInvited, failedToSend };
}

async function loadInvite(db: Db, orgId: string, inviteId: string) {
  const { data, error } = await db
    .from("invites")
    .select("id, email, status, expires_at, job_id, candidate_name, sent_count")
    .eq("id", inviteId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new InviteError("That invite doesn't exist.");
  return data;
}

/**
 * Issues a new link for an invite that hasn't been started. The old token
 * hash is replaced, so the old link stops working, and any pending email code
 * is cleared. Extends expiry to the job deadline (or 14 days).
 */
export async function resendInvite(args: { db: Db; orgId: string; orgName: string; inviteId: string }): Promise<{ email: string }> {
  const { db, orgId, orgName, inviteId } = args;
  const invite = await loadInvite(db, orgId, inviteId);
  if (!canResend(displayStatus(invite.status, invite.expires_at))) {
    throw new InviteError(`Can't resend an invite that is ${invite.status}.`);
  }
  const job = await loadJob(db, orgId, invite.job_id);
  const expiresAt = inviteExpiry(job.deadline);
  if (expiresAt.getTime() <= Date.now()) {
    throw new InviteError("This job's invite deadline has passed.");
  }

  // The RLS-checked update comes first: it proves the caller may manage this
  // invite before the service client touches its secret.
  // sent_count in the filter makes two resends at once count as two attempts:
  // the second matches no row and asks the user to reload.
  const { data: updated, error: updateError } = await db
    .from("invites")
    .update({
      status: "invited",
      expires_at: expiresAt.toISOString(),
      last_sent_at: new Date().toISOString(),
      sent_count: invite.sent_count + 1,
    })
    .eq("id", inviteId)
    .eq("org_id", orgId)
    .eq("sent_count", invite.sent_count)
    .in("status", ["invited", "expired"])
    .select("id");
  if (updateError) {
    // An expired invite whose email was invited again since: reviving it
    // would make two live invites (unique index).
    if (updateError.code === UNIQUE_VIOLATION) {
      throw new InviteError(`${invite.email} already has a newer invite for this job. Resend that one instead.`);
    }
    throw updateError;
  }
  if (updated.length !== 1) throw new InviteError("That invite changed in the meantime. Reload and try again.");

  const token = generateToken();
  const { error: secretError } = await createServiceClient()
    .from("invite_secrets")
    .upsert(
      { invite_id: inviteId, org_id: orgId, token_hash: hashToken(token), code_hash: null, code_expires_at: null, code_attempts: 0 },
      { onConflict: "invite_id" },
    );
  if (secretError) throw secretError;

  try {
    await sendWithRetry({ to: invite.email, ...buildInviteEmail({ orgName, jobTitle: job.title, link: inviteLink(token), expiresAt, ...job.emailDetails, candidateName: invite.candidate_name }) });
  } catch (err) {
    console.error("invite email failed", { inviteId, message: err instanceof Error ? err.message : String(err) });
    throw new InviteError(`A new link was created but the email to ${invite.email} failed. Try resending again.`);
  }
  return { email: invite.email };
}

/**
 * Sets an invite's accommodations (D9): extra time and camera / screen
 * waivers. Goes through set_invite_accommodations(), which checks the caller
 * manages the invite's company, refuses once the candidate has started, and
 * writes the audit log; the table has no write policies of its own.
 */
export async function setAccommodations(args: {
  db: Db;
  orgId: string;
  inviteId: string;
  accommodations: Accommodations;
}): Promise<{ email: string }> {
  const { db, orgId, inviteId, accommodations: a } = args;
  const invite = await loadInvite(db, orgId, inviteId);
  const { error } = await db.rpc("set_invite_accommodations", {
    p_invite_id: inviteId,
    p_extra_time_percent: a.extraTimePercent,
    p_waive_camera: a.waiveCamera,
    p_waive_screen: a.waiveScreen,
    p_waive_fullscreen: a.waiveFullscreen,
    p_waive_microphone: a.waiveMicrophone,
  });
  if (error) {
    if (error.code === "55000") throw new InviteError("The candidate has started, so accommodations can no longer change.");
    if (error.code === "42501") throw new InviteError("You don't have permission to change accommodations.");
    if (error.code === "22023") throw new InviteError("Pick +0%, +25%, +50% or +100% extra time.");
    throw error;
  }
  return { email: invite.email };
}

/** Marks an unstarted invite revoked; its link stops working. */
export async function revokeInvite(args: { db: Db; orgId: string; inviteId: string }): Promise<{ email: string }> {
  const { db, orgId, inviteId } = args;
  const invite = await loadInvite(db, orgId, inviteId);
  if (!canRevoke(displayStatus(invite.status, invite.expires_at))) {
    throw new InviteError(`Can't revoke an invite that is ${invite.status}.`);
  }
  const { data, error } = await db
    .from("invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("org_id", orgId)
    .in("status", ["invited", "expired"])
    .select("id");
  if (error) throw error;
  if (data.length !== 1) throw new InviteError("That invite changed in the meantime. Reload and try again.");
  return { email: invite.email };
}
