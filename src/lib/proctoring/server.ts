import "server-only";

import { randomBytes } from "node:crypto";
import { applyWaivers } from "@/lib/accommodations";
import type { Json } from "@/lib/database.types";
import { settleAttempt } from "@/lib/candidate/attempt";
import type { AttemptRow, InviteContext } from "@/lib/candidate/invite";
import type { CandidateSession } from "@/lib/candidate/session";
import { readRetention } from "@/lib/retention/policy";
import { createServiceClient } from "@/lib/supabase/service";
import {
  CONSENT_SIGNAL,
  MAX_SNAPSHOTS_PER_ATTEMPT,
  MONITORING_CONSENT_VERSION,
  PROCTORING_BUCKET,
  readProctoring,
  type MonitoringSettings,
  type SnapshotSource,
} from "./config";
import { recordDownPeriods, refreshFlags } from "./flags";
import { parseSignalBatch } from "./rules";

/**
 * Proctoring for candidate routes. Every function starts from a verified
 * CandidateSession and filters by its attempt and org; nothing the browser
 * sends can name another attempt. Writes use the service role because
 * candidates have no Supabase user (same as src/lib/candidate/attempt.ts).
 */

type AttemptKey = Pick<AttemptRow, "id" | "org_id">;
const ACTIVE: AttemptRow["status"][] = ["not_started", "in_progress"];

/**
 * The camera / screen settings for this candidate: the assessment's, minus any
 * waiver set on the invite (D9; the assessment itself stays locked), plus what
 * the monitoring notice shows (retention, company contact).
 */
export async function getProctoringSettings(session: CandidateSession): Promise<MonitoringSettings> {
  return getInviteProctoringSettings(session.invite);
}

/**
 * The same settings for an invite before the candidate has a session (the
 * verify page shows what will be recorded before they agree).
 */
export async function getInviteProctoringSettings(
  invite: Pick<InviteContext, "assessmentId" | "orgId" | "accommodations" | "contactEmail">,
): Promise<MonitoringSettings> {
  const db = createServiceClient();
  const [assessment, org] = await Promise.all([
    db.from("assessments").select("proctoring").eq("id", invite.assessmentId).eq("org_id", invite.orgId).single(),
    db.from("organizations").select("settings").eq("id", invite.orgId).single(),
  ]);
  if (assessment.error) throw new Error(`proctoring settings lookup failed: ${assessment.error.message}`);
  if (org.error) throw new Error(`org settings lookup failed: ${org.error.message}`);
  const { mediaDays, resultsDays } = readRetention(org.data.settings);
  return {
    ...applyWaivers(readProctoring(assessment.data.proctoring), invite.accommodations),
    mediaRetentionDays: mediaDays,
    resultsRetentionDays: resultsDays,
    contactEmail: invite.contactEmail,
  };
}

// ---------------------------------------------------------------------------
// Signals and flags
// ---------------------------------------------------------------------------

export type RecordSignalsResult = { ok: boolean; recorded: number };

/** A batch of browser signals. Accepted while the attempt is not started (system check) or in progress. */
export async function recordSignals(session: CandidateSession, body: unknown, now = new Date()): Promise<RecordSignalsResult> {
  const attempt = await settleAttempt(session, now);
  if (!ACTIVE.includes(attempt.status)) return { ok: false, recorded: 0 };
  const signals = parseSignalBatch(body, now);
  if (!signals.length) return { ok: true, recorded: 0 };

  const db = createServiceClient();
  const { error } = await db.from("integrity_events").insert(
    signals.map((s) => ({ attempt_id: attempt.id, org_id: attempt.org_id, kind: s.kind, at: s.at, payload: s.payload as Json })),
  );
  if (error) throw new Error(`recording signals failed: ${error.message}`);

  await recordDownPeriods(attempt);
  await refreshFlags(attempt, await getProctoringSettings(session));
  return { ok: true, recorded: signals.length };
}

export { refreshFlags };

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** Records agreement to the monitoring notice (version and what it covered). */
export async function recordConsent(session: CandidateSession, now = new Date()): Promise<boolean> {
  const attempt = await settleAttempt(session, now);
  if (!ACTIVE.includes(attempt.status)) return false;
  const settings = await getProctoringSettings(session);
  const { error } = await createServiceClient()
    .from("integrity_events")
    .insert({
      attempt_id: attempt.id,
      org_id: attempt.org_id,
      kind: CONSENT_SIGNAL,
      at: now.toISOString(),
      payload: { version: MONITORING_CONSENT_VERSION, camera: settings.camera, screen: settings.screen },
    });
  if (error) throw new Error(`recording consent failed: ${error.message}`);
  return true;
}

/** Whether the candidate already agreed to the current monitoring notice. */
export async function hasConsented(attempt: AttemptKey): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("integrity_events")
    .select("payload")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id)
    .eq("kind", CONSENT_SIGNAL);
  if (error) throw new Error(`consent lookup failed: ${error.message}`);
  return data.some((r) => (r.payload as { version?: unknown } | null)?.version === MONITORING_CONSENT_VERSION);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export type UploadResult = { ok: true; path: string; token: string } | { ok: false; error: "not_active" | "not_enabled" | "too_many" };

/**
 * A signed upload URL for one snapshot. The browser uploads straight to
 * storage with the token (never through our API); the path is fixed here,
 * inside the attempt's own folder.
 */
export async function createSnapshotUpload(session: CandidateSession, source: SnapshotSource, now = new Date()): Promise<UploadResult> {
  const attempt = await settleAttempt(session, now);
  if (!ACTIVE.includes(attempt.status)) return { ok: false, error: "not_active" };
  const settings = await getProctoringSettings(session);
  if (!settings[source]) return { ok: false, error: "not_enabled" };

  const db = createServiceClient();
  const { count, error: countError } = await db
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id);
  if (countError) throw new Error(`counting snapshots failed: ${countError.message}`);
  if ((count ?? 0) >= MAX_SNAPSHOTS_PER_ATTEMPT) return { ok: false, error: "too_many" };

  const path = `${attempt.org_id}/${attempt.id}/${source}/${now.getTime()}-${randomBytes(6).toString("hex")}.jpg`;
  const { data, error } = await db.storage.from(PROCTORING_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`creating upload URL failed: ${error.message}`);
  return { ok: true, path: data.path, token: data.token };
}

export type ConfirmResult = { ok: true; mediaId: number } | { ok: false; error: "bad_path" | "missing" | "not_active" };

/** After the upload: checks the file is in this attempt's folder and exists, then records the media row. */
export async function confirmSnapshot(session: CandidateSession, path: unknown, now = new Date()): Promise<ConfirmResult> {
  const attempt = await settleAttempt(session, now);
  const prefix = `${attempt.org_id}/${attempt.id}/`;
  if (typeof path !== "string" || !path.startsWith(prefix)) return { ok: false, error: "bad_path" };
  const match = /^(camera|screen)\/([A-Za-z0-9_-]{1,80}\.jpg)$/.exec(path.slice(prefix.length));
  if (!match) return { ok: false, error: "bad_path" };
  if (!ACTIVE.includes(attempt.status)) return { ok: false, error: "not_active" };
  const [, source, file] = match;

  const db = createServiceClient();
  const { data: listed, error: listError } = await db.storage
    .from(PROCTORING_BUCKET)
    .list(`${prefix}${source}`, { search: file, limit: 10 });
  if (listError) throw new Error(`checking snapshot failed: ${listError.message}`);
  if (!listed?.some((o) => o.name === file)) return { ok: false, error: "missing" };

  const { data: existing } = await db.from("media").select("id").eq("attempt_id", attempt.id).eq("storage_path", path).maybeSingle();
  if (existing) return { ok: true, mediaId: existing.id };

  const { data, error } = await db
    .from("media")
    .insert({ attempt_id: attempt.id, org_id: attempt.org_id, source: source as SnapshotSource, storage_path: path, at: now.toISOString() })
    .select("id")
    .single();
  if (error) throw new Error(`recording snapshot failed: ${error.message}`);
  return { ok: true, mediaId: data.id };
}
