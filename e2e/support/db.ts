/**
 * Arrange and check helpers that go straight to the local test database with
 * the service role. Used to set up states the UI can't reach quickly (time
 * travel, demoting a user mid-session) and to verify what the UI did.
 */
import { must, serviceClient } from "../../tests/helpers/supabase";

export const db = () => serviceClient();

export async function inviteRow(inviteId: string) {
  return must(await db().from("invites").select("id, status, email, candidate_name, expires_at").eq("id", inviteId).single());
}

export async function inviteSecret(inviteId: string) {
  return must(
    await db().from("invite_secrets").select("code_hash, code_expires_at, code_attempts, token_hash").eq("invite_id", inviteId).single(),
  );
}

export async function attemptFor(inviteId: string) {
  return must(
    await db()
      .from("attempts")
      .select("id, status, started_at, deadline_at, submitted_at, submit_reason, score")
      .eq("invite_id", inviteId)
      .maybeSingle(),
  );
}

/** Pretends `minutes` have passed since the attempt started. The deadline moves too unless `keepDeadline`. */
export async function backdateAttempt(inviteId: string, minutes: number, { keepDeadline = false } = {}) {
  const attempt = await attemptFor(inviteId);
  if (!attempt?.started_at || !attempt.deadline_at) throw new Error("attempt has not started");
  const shift = (iso: string) => new Date(new Date(iso).getTime() - minutes * 60_000).toISOString();
  must(
    await db()
      .from("attempts")
      .update({ started_at: shift(attempt.started_at), ...(keepDeadline ? {} : { deadline_at: shift(attempt.deadline_at) }) })
      .eq("id", attempt.id)
      .select("id"),
  );
}

/** Moves the attempt's deadline into the past (the time limit ran out a second ago). */
export async function expireAttempt(inviteId: string) {
  const attempt = await attemptFor(inviteId);
  if (!attempt) throw new Error("no attempt");
  const deadline = new Date(Date.now() - 1_000);
  must(
    await db()
      .from("attempts")
      .update({ started_at: new Date(deadline.getTime() - 15 * 60_000).toISOString(), deadline_at: deadline.toISOString() })
      .eq("id", attempt.id)
      .select("id"),
  );
}

/** Makes the pending email code look `secondsOld` old (codes can be re-sent after 30 s). */
export async function ageCode(inviteId: string, secondsOld: number) {
  const expires = new Date(Date.now() + 10 * 60_000 - secondsOld * 1000).toISOString();
  must(await db().from("invite_secrets").update({ code_expires_at: expires }).eq("invite_id", inviteId).select("invite_id"));
}

export async function expireCode(inviteId: string) {
  must(
    await db()
      .from("invite_secrets")
      .update({ code_expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq("invite_id", inviteId)
      .select("invite_id"),
  );
}

export async function setRole(orgId: string, userId: string, role: "admin" | "recruiter" | "viewer") {
  must(await db().from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", userId).select("user_id"));
}

export async function orgIdForSlug(slug: string) {
  return must(await db().from("organizations").select("id").eq("slug", slug).single()).id;
}

export async function memberIds(orgId: string) {
  return must(await db().from("memberships").select("user_id, role").eq("org_id", orgId));
}

/** Id of an auth user by email (pages through the admin list). */
export async function userIdByEmail(email: string): Promise<string | undefined> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return undefined;
  }
}

export async function invitesForJob(jobId: string) {
  return must(await db().from("invites").select("id, email, status").eq("job_id", jobId).order("email"));
}
