import "server-only";

import { readAccommodations, type Accommodations } from "@/lib/accommodations";
import { createClient } from "@/lib/supabase/server";
import { readProctoring, type Proctoring } from "./schemas";
import { displayStatus, type InviteStatus } from "./status";

// Reads for the jobs area, all through the signed-in user's client so RLS
// limits them to the user's company. Every query also filters by org_id.

export type LibraryScenario = { id: string; slug: string; version: number; title: string; roleFamily: string };

/** Published platform-library scenarios (org_id null). */
export async function listLibraryScenarios(): Promise<LibraryScenario[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("scenarios")
    .select("id, slug, version, title, role_family")
    .is("org_id", null)
    .not("published_at", "is", null)
    .order("title")
    .order("version", { ascending: false });
  if (error) throw error;
  return data.map((s) => ({ id: s.id, slug: s.slug, version: s.version, title: s.title, roleFamily: s.role_family }));
}

export type AssessmentSummary = {
  id: string;
  title: string;
  scenarioId: string;
  scenarioTitle: string;
  timeLimitMinutes: number;
  passScore: number | null;
  proctoring: Proctoring;
  lockedAt: string | null;
  createdAt: string;
};

export async function listAssessments(orgId: string): Promise<AssessmentSummary[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("assessments")
    .select("id, title, scenario_id, time_limit_minutes, pass_score, proctoring, locked_at, created_at, scenarios(title, version)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    title: a.title,
    scenarioId: a.scenario_id,
    scenarioTitle: a.scenarios ? `${a.scenarios.title} (v${a.scenarios.version})` : "(unknown scenario)",
    timeLimitMinutes: a.time_limit_minutes,
    passScore: a.pass_score,
    proctoring: readProctoring(a.proctoring),
    lockedAt: a.locked_at,
    createdAt: a.created_at,
  }));
}

export type JobSummary = {
  id: string;
  title: string;
  assessmentId: string;
  assessmentTitle: string;
  deadline: string | null;
  createdAt: string;
  inviteCounts: Record<InviteStatus, number>;
};

function emptyCounts(): Record<InviteStatus, number> {
  return { invited: 0, started: 0, completed: 0, expired: 0, revoked: 0 };
}

export async function listJobs(orgId: string): Promise<JobSummary[]> {
  const db = await createClient();
  const [jobs, invites] = await Promise.all([
    db
      .from("jobs")
      .select("id, title, assessment_id, deadline, created_at, assessments(title)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    db.from("invites").select("job_id, status, expires_at").eq("org_id", orgId),
  ]);
  if (jobs.error) throw jobs.error;
  if (invites.error) throw invites.error;

  const counts = new Map<string, Record<InviteStatus, number>>();
  const now = Date.now();
  for (const i of invites.data) {
    const c = counts.get(i.job_id) ?? emptyCounts();
    c[displayStatus(i.status, i.expires_at, now)]++;
    counts.set(i.job_id, c);
  }
  return jobs.data.map((j) => ({
    id: j.id,
    title: j.title,
    assessmentId: j.assessment_id,
    assessmentTitle: j.assessments?.title ?? "(unknown assessment)",
    deadline: j.deadline,
    createdAt: j.created_at,
    inviteCounts: counts.get(j.id) ?? emptyCounts(),
  }));
}

export type JobDetail = {
  id: string;
  title: string;
  deadline: string | null;
  createdAt: string;
  assessment: { id: string; title: string; timeLimitMinutes: number; passScore: number | null; proctoring: Proctoring; lockedAt: string | null } | null;
};

export async function getJob(orgId: string, jobId: string): Promise<JobDetail | null> {
  const db = await createClient();
  const { data, error } = await db
    .from("jobs")
    .select("id, title, deadline, created_at, assessments(id, title, time_limit_minutes, pass_score, proctoring, locked_at)")
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const a = data.assessments;
  return {
    id: data.id,
    title: data.title,
    deadline: data.deadline,
    createdAt: data.created_at,
    assessment: a
      ? {
          id: a.id,
          title: a.title,
          timeLimitMinutes: a.time_limit_minutes,
          passScore: a.pass_score,
          proctoring: readProctoring(a.proctoring),
          lockedAt: a.locked_at,
        }
      : null,
  };
}

export type InviteRow = {
  id: string;
  email: string;
  candidateName: string | null;
  status: InviteStatus;
  sentAt: string;
  /** When the link was last emailed (first send or latest resend). */
  lastSentAt: string;
  sentCount: number;
  expiresAt: string;
  accommodations: Accommodations;
  /** Accommodations can change until the candidate starts. */
  started: boolean;
};

export async function listInvites(orgId: string, jobId: string): Promise<InviteRow[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("invites")
    .select("id, email, candidate_name, status, created_at, last_sent_at, sent_count, expires_at, attempts(started_at)")
    .eq("org_id", orgId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .order("email");
  if (error) throw error;
  const accommodations = await accommodationsFor(orgId, data.map((i) => i.id));
  const now = Date.now();
  return data.map((i) => ({
    id: i.id,
    email: i.email,
    candidateName: i.candidate_name,
    status: displayStatus(i.status, i.expires_at, now),
    sentAt: i.created_at,
    lastSentAt: i.last_sent_at,
    sentCount: i.sent_count,
    expiresAt: i.expires_at,
    accommodations: accommodations.get(i.id) ?? readAccommodations(null),
    started: i.status === "started" || i.status === "completed" || startedAt(i.attempts) !== null,
  }));
}

function startedAt(attempts: { started_at: string | null } | { started_at: string | null }[] | null): string | null {
  const list = Array.isArray(attempts) ? attempts : attempts ? [attempts] : [];
  return list.find((a) => a.started_at)?.started_at ?? null;
}

/** Accommodations by invite id, for invites that have a row (D9). */
export async function accommodationsFor(orgId: string, inviteIds: string[]): Promise<Map<string, Accommodations>> {
  const out = new Map<string, Accommodations>();
  if (!inviteIds.length) return out;
  const db = await createClient();
  // Chunked so a long invite list doesn't make an overlong URL.
  for (let n = 0; n < inviteIds.length; n += 200) {
    const { data, error } = await db
      .from("invite_accommodations")
      .select("invite_id, extra_time_percent, waive_camera, waive_screen, waive_fullscreen, waive_microphone")
      .eq("org_id", orgId)
      .in("invite_id", inviteIds.slice(n, n + 200));
    if (error) throw error;
    for (const row of data) out.set(row.invite_id, readAccommodations(row));
  }
  return out;
}

/** One invite's accommodations, for the candidate report. */
export async function getInviteAccommodations(orgId: string, inviteId: string): Promise<Accommodations> {
  return (await accommodationsFor(orgId, [inviteId])).get(inviteId) ?? readAccommodations(null);
}
