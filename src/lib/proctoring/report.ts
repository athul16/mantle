import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { PROCTORING_BUCKET, readProctoring, type Proctoring } from "./config";
import type { EvidenceEvent } from "./rules";

/**
 * Flags for the candidate report, read with the signed-in member's own client
 * so RLS decides what they see: every member reads flags; snapshot rows and
 * files only for admins and recruiters (viewers when the org allows it).
 * Thumbnails are short-lived signed URLs created with that same client, so
 * storage policies check them too.
 */

export type ReportFlagMedia = { id: number; source: "camera" | "screen" | "phone"; at: string; url: string };

export type ReportFlag = {
  id: string;
  rule: string | null;
  reason: string;
  status: "open" | "confirmed" | "cleared";
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewerEmail: string | null;
  createdAt: string;
  events: Pick<EvidenceEvent, "kind" | "at" | "awayMs" | "chars" | "surface">[];
  media: ReportFlagMedia[];
};

export type FlagsReport = { flags: ReportFlag[]; canSeeMedia: boolean };

/** Signed thumbnail URLs last this long; the report page renders fresh ones on every load. */
const URL_SECONDS = 10 * 60;

type Db = SupabaseClient<Database>;

export async function getFlagsForReport(db: Db, orgId: string, attemptId: string): Promise<FlagsReport> {
  const [flagsRes, canSeeMedia] = await Promise.all([
    db
      .from("flags")
      .select("id, rule, reason, status, review_note, reviewed_at, reviewed_by, created_at, evidence")
      .eq("org_id", orgId)
      .eq("attempt_id", attemptId)
      .order("created_at"),
    memberCanSeeMedia(db, orgId),
  ]);
  if (flagsRes.error) throw flagsRes.error;
  const rows = flagsRes.data ?? [];

  const evidenceOf = (e: unknown) => (e ?? {}) as { events?: EvidenceEvent[]; mediaIds?: number[] };
  const mediaIds = [...new Set(rows.flatMap((r) => evidenceOf(r.evidence).mediaIds ?? []))].filter((n) => Number.isInteger(n));
  const media = canSeeMedia && mediaIds.length ? await signedMedia(db, orgId, attemptId, mediaIds) : new Map<number, ReportFlagMedia>();
  const emails = await reviewerEmails(rows.map((r) => r.reviewed_by).filter((id): id is string => !!id));

  return {
    canSeeMedia,
    flags: rows.map((r) => {
      const ev = evidenceOf(r.evidence);
      return {
        id: r.id,
        rule: r.rule,
        reason: r.reason,
        status: r.status === "confirmed" || r.status === "cleared" ? r.status : "open",
        reviewNote: r.review_note,
        reviewedAt: r.reviewed_at,
        reviewerEmail: r.reviewed_by ? (emails.get(r.reviewed_by) ?? "(former teammate)") : null,
        createdAt: r.created_at,
        events: (ev.events ?? []).map(({ kind, at, awayMs, chars, surface }) => ({ kind, at, awayMs, chars, surface })),
        media: (ev.mediaIds ?? []).map((id) => media.get(id)).filter((m): m is ReportFlagMedia => !!m),
      };
    }),
  };
}

/** Same rule as the media policy: admins and recruiters; viewers when the org turns it on. */
async function memberCanSeeMedia(db: Db, orgId: string): Promise<boolean> {
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return false;
  const [membership, org] = await Promise.all([
    db.from("memberships").select("role").eq("org_id", orgId).eq("user_id", auth.user.id).maybeSingle(),
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
  ]);
  const role = membership.data?.role;
  if (role === "admin" || role === "recruiter") return true;
  const settings = (org.data?.settings ?? {}) as { viewers_see_media?: unknown };
  return role === "viewer" && settings.viewers_see_media === true;
}

async function signedMedia(db: Db, orgId: string, attemptId: string, ids: number[]): Promise<Map<number, ReportFlagMedia>> {
  const { data: rows, error } = await db
    .from("media")
    .select("id, at, source, storage_path")
    .eq("org_id", orgId)
    .eq("attempt_id", attemptId)
    .in("id", ids);
  if (error) throw error;
  if (!rows?.length) return new Map();
  const { data: signed, error: signError } = await db.storage
    .from(PROCTORING_BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), URL_SECONDS);
  if (signError) throw signError;
  const urlFor = new Map((signed ?? []).filter((s) => s.signedUrl && !s.error).map((s) => [s.path, s.signedUrl]));
  const out = new Map<number, ReportFlagMedia>();
  for (const r of rows) {
    const url = urlFor.get(r.storage_path);
    if (url) out.set(r.id, { id: r.id, at: r.at, source: r.source as ReportFlagMedia["source"], url });
  }
  return out;
}

/** Reviewer emails (auth admin lookup, like note authors on the report). */
async function reviewerEmails(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const service = createServiceClient();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const { data } = await service.auth.admin.getUserById(id);
      if (data.user?.email) out.set(id, data.user.email);
    }),
  );
  return out;
}

/** Counts for the report summary. */
export function flagCounts(flags: Pick<ReportFlag, "status">[]): { total: number; open: number; reviewed: number } {
  const open = flags.filter((f) => f.status === "open").length;
  return { total: flags.length, open, reviewed: flags.length - open };
}

/** The assessment's camera / screen settings for an invite (read through RLS). */
export async function getInviteProctoring(db: Db, orgId: string, inviteId: string): Promise<Proctoring> {
  const { data, error } = await db.from("invites").select("jobs(assessments(proctoring))").eq("org_id", orgId).eq("id", inviteId).maybeSingle();
  if (error) throw error;
  return readProctoring(data?.jobs?.assessments?.proctoring);
}
