import "server-only";

import { sendEmail } from "@/lib/email";
import { createServiceClient } from "@/lib/supabase/service";
import { generateCode, generateToken, hashCode, hashToken, safeEqual } from "@/lib/tokens";
import { CODE_RESEND_SECONDS, CODE_TTL_MINUTES, CONSENT_VERSION, MAX_CODE_ATTEMPTS } from "./config";
import { findAttemptForInvite, findInviteByToken, inviteBlockReason, type InviteContext } from "./invite";

/**
 * Email-code verification. The link token alone only identifies the invite;
 * a candidate gets a session only after typing the 6-digit code we emailed.
 * Raw codes and session tokens are never stored, only their hashes in the
 * service-only secret tables.
 */

const UNIQUE_VIOLATION = "23505";

export type RequestCodeResult =
  | { ok: true; email: string }
  | { ok: false; error: "invalid" | "revoked" | "expired" | "completed" | "too_soon" };

/** Emails a fresh code for the invite. Called only from an explicit POST (the Continue button). */
export async function requestCode(token: string, now = new Date()): Promise<RequestCodeResult> {
  const invite = await findInviteByToken(token);
  if (!invite) return { ok: false, error: "invalid" };
  const attempt = await findAttemptForInvite(invite.inviteId, invite.orgId);
  const blocked = inviteBlockReason(invite, attempt, now);
  if (blocked) return { ok: false, error: blocked };

  const db = createServiceClient();
  const { data: secret, error } = await db
    .from("invite_secrets")
    .select("code_expires_at")
    .eq("invite_id", invite.inviteId)
    .single();
  if (error) throw new Error(`invite secret lookup failed: ${error.message}`);

  // A code's issue time is its expiry minus the TTL; no extra column needed.
  if (secret.code_expires_at) {
    const issuedAt = new Date(secret.code_expires_at).getTime() - CODE_TTL_MINUTES * 60_000;
    if (now.getTime() - issuedAt < CODE_RESEND_SECONDS * 1000) return { ok: false, error: "too_soon" };
  }

  // Conditional on the expiry we just read, so parallel requests (double
  // click, a script) can't all pass the cooldown check: one wins, the rest
  // match no row and get too_soon.
  const code = generateCode();
  const update = db
    .from("invite_secrets")
    .update({
      code_hash: hashCode(code, invite.inviteId),
      code_expires_at: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString(),
      code_attempts: 0,
    })
    .eq("invite_id", invite.inviteId);
  const { data: stored, error: updateError } = await (secret.code_expires_at
    ? update.eq("code_expires_at", secret.code_expires_at)
    : update.is("code_expires_at", null)
  ).select("invite_id");
  if (updateError) throw new Error(`storing code failed: ${updateError.message}`);
  if (!stored?.length) return { ok: false, error: "too_soon" };

  await sendEmail({
    to: invite.email,
    subject: `Your code for the ${invite.companyName} assessment: ${code}`,
    text: [
      `Your verification code is ${code}.`,
      "",
      `Enter it on the page where you clicked Continue to open the ${invite.jobTitle} assessment from ${invite.companyName}.`,
      `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
    ].join("\n"),
  });

  return { ok: true, email: maskEmail(invite.email) };
}

export type VerifyError =
  | "invalid"
  | "revoked"
  | "expired"
  | "completed"
  | "no_code"
  | "code_expired"
  | "wrong_code"
  | "locked"
  | "busy"
  | "bad_input";

export type VerifyResult =
  | { ok: true; sessionToken: string; attemptId: string; resumed: boolean }
  | { ok: false; error: VerifyError; triesLeft?: number };

export interface VerifyInput {
  token: string;
  code: string;
  name: string;
  consent: boolean;
}

/**
 * Checks the emailed code. On success: creates the attempt (or reuses the
 * existing one to resume), issues a new session token (any older session for
 * this attempt stops working), marks the invite started and locks the
 * assessment. The timer itself starts later, on the instructions page.
 */
export async function verifyCode(input: VerifyInput, now = new Date()): Promise<VerifyResult> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const code = input.code.replace(/\s/g, "");
  if (!name || name.length > 120 || !/^\d{6}$/.test(code) || !input.consent) return { ok: false, error: "bad_input" };

  const invite = await findInviteByToken(input.token);
  if (!invite) return { ok: false, error: "invalid" };
  const existing = await findAttemptForInvite(invite.inviteId, invite.orgId);
  const blocked = inviteBlockReason(invite, existing, now);
  if (blocked) return { ok: false, error: blocked };

  const db = createServiceClient();
  const { data: secret, error } = await db
    .from("invite_secrets")
    .select("code_hash, code_expires_at, code_attempts")
    .eq("invite_id", invite.inviteId)
    .single();
  if (error) throw new Error(`invite secret lookup failed: ${error.message}`);

  if (!secret.code_hash || !secret.code_expires_at) return { ok: false, error: "no_code" };
  if (secret.code_attempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "locked", triesLeft: 0 };
  if (now > new Date(secret.code_expires_at)) return { ok: false, error: "code_expired" };

  // Count the try before checking it, conditional on the count we read, so
  // parallel guesses can't share one slot and exceed the limit.
  const { data: counted, error: countError } = await db
    .from("invite_secrets")
    .update({ code_attempts: secret.code_attempts + 1 })
    .eq("invite_id", invite.inviteId)
    .eq("code_attempts", secret.code_attempts)
    .eq("code_hash", secret.code_hash)
    .select("invite_id");
  if (countError) throw new Error(`counting code try failed: ${countError.message}`);
  if (!counted?.length) return { ok: false, error: "busy" };

  if (!safeEqual(hashCode(code, invite.inviteId), secret.code_hash)) {
    const triesLeft = MAX_CODE_ATTEMPTS - (secret.code_attempts + 1);
    return { ok: false, error: triesLeft > 0 ? "wrong_code" : "locked", triesLeft };
  }

  // Use the code up. Only one request can win this.
  const { data: consumed, error: consumeError } = await db
    .from("invite_secrets")
    .update({ code_hash: null, code_expires_at: null, code_attempts: 0 })
    .eq("invite_id", invite.inviteId)
    .eq("code_hash", secret.code_hash)
    .select("invite_id");
  if (consumeError) throw new Error(`using code failed: ${consumeError.message}`);
  if (!consumed?.length) return { ok: false, error: "no_code" };

  const attemptId = existing?.id ?? (await createAttempt(invite));
  const sessionToken = generateToken();
  await setSessionHash(attemptId, invite.orgId, hashToken(sessionToken));

  const nowIso = now.toISOString();
  const [inviteUpdate, lockUpdate, eventInsert] = await Promise.all([
    db
      .from("invites")
      .update({ status: "started", candidate_name: name })
      .eq("id", invite.inviteId)
      .eq("org_id", invite.orgId)
      .in("status", ["invited", "started"]),
    db.from("assessments").update({ locked_at: nowIso }).eq("id", invite.assessmentId).eq("org_id", invite.orgId).is("locked_at", null),
    db.from("action_events").insert({
      attempt_id: attemptId,
      org_id: invite.orgId,
      kind: "verified",
      payload: { consent: true, consentVersion: CONSENT_VERSION, resumed: Boolean(existing) },
    }),
  ]);
  for (const r of [inviteUpdate, lockUpdate, eventInsert]) {
    if (r.error) throw new Error(`finishing verification failed: ${r.error.message}`);
  }

  return { ok: true, sessionToken, attemptId, resumed: Boolean(existing) };
}

async function createAttempt(invite: InviteContext): Promise<string> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("attempts")
    .insert({ org_id: invite.orgId, invite_id: invite.inviteId, scenario_id: invite.scenarioId, status: "not_started" })
    .select("id")
    .single();
  if (!error) return data.id;
  if (error.code === UNIQUE_VIOLATION) {
    const raced = await findAttemptForInvite(invite.inviteId, invite.orgId);
    if (raced) return raced.id;
  }
  throw new Error(`creating attempt failed: ${error.message}`);
}

/** New session hash for the attempt. The seed is created once and never changed. */
async function setSessionHash(attemptId: string, orgId: string, sessionHash: string) {
  const db = createServiceClient();
  const { error } = await db
    .from("attempt_secrets")
    .insert({ attempt_id: attemptId, org_id: orgId, seed: generateToken(), session_token_hash: sessionHash });
  if (!error) return;
  if (error.code !== UNIQUE_VIOLATION) throw new Error(`storing attempt secrets failed: ${error.message}`);
  const { error: updateError } = await db
    .from("attempt_secrets")
    .update({ session_token_hash: sessionHash })
    .eq("attempt_id", attemptId)
    .eq("org_id", orgId);
  if (updateError) throw new Error(`updating session failed: ${updateError.message}`);
}

/** "jane.doe@firm.com" -> "ja•••@firm.com", for "we sent a code to ..." */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "your email";
  return `${user.slice(0, 2)}•••@${domain}`;
}
