import "server-only";

import { randomBytes } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { settleAttempt } from "@/lib/candidate/attempt";
import type { AttemptRow } from "@/lib/candidate/invite";
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
  type Proctoring,
  type SnapshotSource,
} from "./config";
import { evaluateRules, integrityLabel, parseSignalBatch, type MediaRef, type SignalEvent } from "./rules";

/**
 * Proctoring for candidate routes. Every function starts from a verified
 * CandidateSession and filters by its attempt and org; nothing the browser
 * sends can name another attempt. Writes use the service role because
 * candidates have no Supabase user (same as src/lib/candidate/attempt.ts).
 */

type AttemptKey = Pick<AttemptRow, "id" | "org_id">;
const ACTIVE: AttemptRow["status"][] = ["not_started", "in_progress"];

/** The assessment's camera / screen settings for this candidate. */
export async function getProctoringSettings(session: CandidateSession): Promise<MonitoringSettings> {
  const db = createServiceClient();
  const [assessment, org] = await Promise.all([
    db.from("assessments").select("proctoring").eq("id", session.invite.assessmentId).eq("org_id", session.invite.orgId).single(),
    db.from("organizations").select("settings").eq("id", session.invite.orgId).single(),
  ]);
  if (assessment.error) throw new Error(`proctoring settings lookup failed: ${assessment.error.message}`);
  if (org.error) throw new Error(`org settings lookup failed: ${org.error.message}`);
  const { mediaDays, resultsDays } = readRetention(org.data.settings);
  return { ...readProctoring(assessment.data.proctoring), mediaRetentionDays: mediaDays, resultsRetentionDays: resultsDays };
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

  await refreshFlags(attempt, await getProctoringSettings(session));
  return { ok: true, recorded: signals.length };
}

/**
 * Re-runs the rules over everything recorded for the attempt. New rules get a
 * flag; open flags get the latest reason and evidence; flags a recruiter has
 * already confirmed or cleared are left exactly as reviewed. Also sets the
 * attempt's integrity label.
 */
export async function refreshFlags(attempt: AttemptKey, settings: Proctoring): Promise<void> {
  const db = createServiceClient();
  const [events, media, existing] = await Promise.all([
    db.from("integrity_events").select("id, at, kind, payload").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).order("at").limit(5000),
    db.from("media").select("id, at, source").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).order("at").limit(5000),
    db.from("flags").select("id, rule, status").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).not("rule", "is", null),
  ]);
  for (const r of [events, media, existing]) if (r.error) throw new Error(`loading proctoring data failed: ${r.error.message}`);

  const drafts = evaluateRules((events.data ?? []) as SignalEvent[], (media.data ?? []) as MediaRef[], settings);
  const byRule = new Map((existing.data ?? []).map((f) => [f.rule!, f]));

  for (const d of drafts) {
    const current = byRule.get(d.rule);
    const evidence = d.evidence as unknown as Json;
    if (!current) {
      const { error } = await db
        .from("flags")
        .insert({ attempt_id: attempt.id, org_id: attempt.org_id, rule: d.rule, reason: d.reason, evidence });
      // 23505: a parallel batch raised the same rule first; the next batch updates it.
      if (error && error.code !== "23505") throw new Error(`raising flag failed: ${error.message}`);
    } else if (current.status === "open") {
      const { error } = await db.from("flags").update({ reason: d.reason, evidence }).eq("id", current.id).eq("status", "open");
      if (error) throw new Error(`updating flag failed: ${error.message}`);
    }
  }

  const { error } = await db
    .from("attempts")
    .update({ integrity_label: integrityLabel(drafts) })
    .eq("id", attempt.id)
    .eq("org_id", attempt.org_id);
  if (error) throw new Error(`setting integrity label failed: ${error.message}`);
}

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
