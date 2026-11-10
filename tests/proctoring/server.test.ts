/**
 * Proctoring on the server, against the local test database and storage:
 * browser signals become integrity events, rules turn them into flags with
 * evidence, snapshots go into the private bucket through signed upload URLs,
 * and recruiters review flags. Creates its own companies and deletes them.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { anonClient, createTestData, must, serviceClient, signedInClient, type Db, type TestCompany } from "../helpers";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let acting: Db;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting }));

const { generateToken, hashToken } = await import("@/lib/tokens");
const { getCandidateSession } = await import("@/lib/candidate/session");
const { SESSION_COOKIE } = await import("@/lib/candidate/config");
const proctoring = await import("@/lib/proctoring/server");
const { getFlagsForReport } = await import("@/lib/proctoring/report");
const { reviewFlag } = await import("@/app/app/[orgSlug]/candidates/[inviteId]/flag-actions");
const signalsRoute = await import("@/app/api/candidate/proctoring/signals/route");
const uploadRoute = await import("@/app/api/candidate/proctoring/upload/route");
const consentRoute = await import("@/app/api/candidate/proctoring/consent/route");

const data = createTestData("proctoring");
const db = serviceClient();
const BUCKET = "proctoring";
// An 8×8 JPEG.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAigAwAEAAAAAQAAAAgAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAH/2gAMAwEAAhEDEQA/API6KKK/tQ/kc//Z",
  "base64",
);

let co: TestCompany;
let scenarioId = "";
let proctoredJob = "";
let plainJob = "";
const clients: Partial<Record<"admin" | "recruiter" | "viewer", Db>> = {};

/** An invite + attempt with a live candidate session. Returns the session token and ids. */
async function candidate(jobId: string, status: "not_started" | "in_progress" | "submitted" = "in_progress") {
  const inv = await data.invite({ orgId: co.orgId, jobId });
  const { attemptId } = await data.attempt({ orgId: co.orgId, inviteId: inv.inviteId, scenarioId, status });
  const token = generateToken();
  must(await db.from("attempt_secrets").update({ session_token_hash: hashToken(token) }).eq("attempt_id", attemptId));
  const session = (await getCandidateSession(token))!;
  return { token, session, attemptId, inviteId: inv.inviteId };
}

function request(path: string, sessionToken: string | null, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  if (sessionToken) headers.set("cookie", `${SESSION_COOKIE}=${sessionToken}`);
  return new NextRequest(new URL(path, "http://localhost:3210"), { method: "POST", headers, body: JSON.stringify(body) });
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeAll(async () => {
  co = await data.company();
  const proctored = await data.assessment({ orgId: co.orgId, proctoring: { camera: true, screen: true } });
  scenarioId = proctored.scenarioId;
  proctoredJob = (await data.job({ orgId: co.orgId, assessmentId: proctored.assessmentId })).jobId;
  const plain = await data.assessment({ orgId: co.orgId });
  plainJob = (await data.job({ orgId: co.orgId, assessmentId: plain.assessmentId })).jobId;
  for (const role of ["admin", "recruiter", "viewer"] as const) {
    clients[role] = await signedInClient(co.users[role].email, co.users[role].password);
  }
});

afterAll(async () => {
  const { data: files } = await db.storage.from(BUCKET).list(co.orgId);
  // Objects live under <org>/<attempt>/<source>/; remove everything the tests wrote.
  for (const attemptDir of files ?? []) {
    for (const source of ["camera", "screen"]) {
      const prefix = `${co.orgId}/${attemptDir.name}/${source}`;
      const { data: objs } = await db.storage.from(BUCKET).list(prefix);
      if (objs?.length) await db.storage.from(BUCKET).remove(objs.map((o) => `${prefix}/${o.name}`));
    }
  }
  await data.cleanup();
});

describe("signals", () => {
  it("records browser signals as integrity events with the browser's timestamps", async () => {
    const c = await candidate(proctoredJob);
    const res = await proctoring.recordSignals(c.session, {
      signals: [
        { kind: "left_window", at: iso(5000) },
        { kind: "returned_to_window", at: iso(1000), awayMs: 4000 },
        { kind: "bogus", at: iso(500) },
      ],
    });
    expect(res).toEqual({ ok: true, recorded: 2 });
    const rows = must(await db.from("integrity_events").select("kind, at, payload").eq("attempt_id", c.attemptId).order("at"));
    expect(rows.map((r) => r.kind)).toEqual(["left_window", "returned_to_window"]);
    expect(rows[1].payload).toEqual({ awayMs: 4000 });
  });

  it("turns signals into flags with evidence and sets the attempt's integrity label", async () => {
    const c = await candidate(proctoredJob);
    await proctoring.recordSignals(c.session, {
      signals: [
        { kind: "screen_share_stopped", at: iso(60_000) },
        { kind: "pasted", at: iso(50_000), chars: 400 },
      ],
    });
    const flags = must(await db.from("flags").select("rule, reason, status, evidence").eq("attempt_id", c.attemptId).order("rule"));
    expect(flags.map((f) => f.rule)).toEqual(["paste", "screen_share"]);
    expect(flags[1]).toMatchObject({ reason: "Screen sharing stopped 1 time", status: "open" });
    expect((flags[1].evidence as { events: { kind: string }[] }).events[0].kind).toBe("screen_share_stopped");
    const attempt = must(await db.from("attempts").select("integrity_label").eq("id", c.attemptId).single());
    expect(attempt.integrity_label).toBe("review");
  });

  it("updates an open flag as more signals arrive, without duplicating it", async () => {
    const c = await candidate(proctoredJob);
    await proctoring.recordSignals(c.session, { signals: [{ kind: "screen_share_stopped", at: iso(90_000) }] });
    await proctoring.recordSignals(c.session, { signals: [{ kind: "screen_share_stopped", at: iso(30_000) }] });
    const flags = must(await db.from("flags").select("reason").eq("attempt_id", c.attemptId));
    expect(flags).toEqual([{ reason: "Screen sharing stopped 2 times" }]);
  });

  it("leaves a flag a recruiter already reviewed exactly as reviewed", async () => {
    const c = await candidate(proctoredJob);
    await proctoring.recordSignals(c.session, { signals: [{ kind: "camera_stopped", at: iso(90_000) }] });
    must(
      await db
        .from("flags")
        .update({ status: "cleared", review_note: "camera glitch", reviewed_by: co.users.recruiter.id, reviewed_at: new Date().toISOString() })
        .eq("attempt_id", c.attemptId),
    );
    await proctoring.recordSignals(c.session, { signals: [{ kind: "camera_stopped", at: iso(10_000) }] });
    const flags = must(await db.from("flags").select("reason, status, review_note").eq("attempt_id", c.attemptId));
    expect(flags).toEqual([{ reason: "Camera turned off 1 time", status: "cleared", review_note: "camera glitch" }]);
  });

  it("ignores signals once the attempt is submitted", async () => {
    const c = await candidate(proctoredJob, "submitted");
    expect(await proctoring.recordSignals(c.session, { signals: [{ kind: "left_window", at: iso(1) }] })).toEqual({ ok: false, recorded: 0 });
  });

  it("records signals through the route only with a candidate session", async () => {
    const c = await candidate(plainJob);
    const anon = await signalsRoute.POST(request("/api/candidate/proctoring/signals", null, { signals: [] }));
    expect(anon.status).toBe(401);
    const ok = await signalsRoute.POST(
      request("/api/candidate/proctoring/signals", c.token, { signals: [{ kind: "copied", at: iso(1), chars: 3 }] }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, recorded: 1 });
  });
});

describe("consent", () => {
  it("stores the consent version and what was agreed to", async () => {
    const c = await candidate(proctoredJob, "not_started");
    const res = await consentRoute.POST(request("/api/candidate/proctoring/consent", c.token, { agree: true }));
    expect(res.status).toBe(200);
    const [row] = must(await db.from("integrity_events").select("kind, payload").eq("attempt_id", c.attemptId));
    expect(row.kind).toBe("consented_to_monitoring");
    expect(row.payload).toMatchObject({ camera: true, screen: true, version: expect.any(String) });
  });

  it("refuses without agreement", async () => {
    const c = await candidate(proctoredJob, "not_started");
    const res = await consentRoute.POST(request("/api/candidate/proctoring/consent", c.token, { agree: false }));
    expect(res.status).toBe(400);
  });
});

describe("snapshots", () => {
  it("gives a signed upload URL under the attempt's own folder, then records the media row", async () => {
    const c = await candidate(proctoredJob);
    const up = await proctoring.createSnapshotUpload(c.session, "camera");
    if (!up.ok) throw new Error(up.error);
    expect(up.path.startsWith(`${co.orgId}/${c.attemptId}/camera/`)).toBe(true);
    expect(up.path).toMatch(/\.jpg$/);

    // The browser uploads with only the token: no key, no session.
    must(await anonClient().storage.from(BUCKET).uploadToSignedUrl(up.path, up.token, JPEG, { contentType: "image/jpeg" }));

    const confirmed = await proctoring.confirmSnapshot(c.session, up.path);
    expect(confirmed.ok).toBe(true);
    const rows = must(await db.from("media").select("source, storage_path").eq("attempt_id", c.attemptId));
    expect(rows).toEqual([{ source: "camera", storage_path: up.path }]);
  });

  it("refuses a source the assessment does not use", async () => {
    const c = await candidate(plainJob);
    expect(await proctoring.createSnapshotUpload(c.session, "camera")).toEqual({ ok: false, error: "not_enabled" });
  });

  it("refuses once the attempt is over", async () => {
    const c = await candidate(proctoredJob, "submitted");
    expect(await proctoring.createSnapshotUpload(c.session, "screen")).toEqual({ ok: false, error: "not_active" });
  });

  it("refuses to record a path outside the attempt's folder or a file that was never uploaded", async () => {
    const a = await candidate(proctoredJob);
    const b = await candidate(proctoredJob);
    const upB = await proctoring.createSnapshotUpload(b.session, "screen");
    if (!upB.ok) throw new Error(upB.error);
    expect(await proctoring.confirmSnapshot(a.session, upB.path)).toEqual({ ok: false, error: "bad_path" });
    expect(await proctoring.confirmSnapshot(a.session, `${co.orgId}/${a.attemptId}/screen/../../x.jpg`)).toEqual({ ok: false, error: "bad_path" });
    expect(await proctoring.confirmSnapshot(a.session, `${co.orgId}/${a.attemptId}/screen/1-never.jpg`)).toEqual({ ok: false, error: "missing" });
  });

  it("the upload route returns a URL and token, never a key", async () => {
    const c = await candidate(proctoredJob);
    const res = await uploadRoute.POST(request("/api/candidate/proctoring/upload", c.token, { source: "screen" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["ok", "path", "token"]);
    expect(JSON.stringify(body)).not.toContain(process.env.SUPABASE_SECRET_KEY!);
  });
});

describe("report", () => {
  let attemptId = "";
  let flagId = "";

  beforeAll(async () => {
    const c = await candidate(proctoredJob);
    attemptId = c.attemptId;
    const up = await proctoring.createSnapshotUpload(c.session, "screen");
    if (!up.ok) throw new Error(up.error);
    must(await anonClient().storage.from(BUCKET).uploadToSignedUrl(up.path, up.token, JPEG, { contentType: "image/jpeg" }));
    await proctoring.confirmSnapshot(c.session, up.path);
    await proctoring.recordSignals(c.session, { signals: [{ kind: "screen_share_stopped", at: new Date().toISOString() }] });
    flagId = must(await db.from("flags").select("id").eq("attempt_id", attemptId).single()).id;
  });

  it("shows admins and recruiters each flag with signed thumbnail URLs", async () => {
    for (const role of ["admin", "recruiter"] as const) {
      const report = await getFlagsForReport(clients[role]!, co.orgId, attemptId);
      expect(report.canSeeMedia).toBe(true);
      expect(report.flags).toHaveLength(1);
      expect(report.flags[0]).toMatchObject({ rule: "screen_share", status: "open" });
      expect(report.flags[0].media).toHaveLength(1);
      expect(report.flags[0].media[0].url).toMatch(/\/storage\/v1\/object\/sign\/proctoring\//);
    }
  });

  it("shows viewers the flags but no snapshots unless the company allows it", async () => {
    const report = await getFlagsForReport(clients.viewer!, co.orgId, attemptId);
    expect(report.flags).toHaveLength(1);
    expect(report.canSeeMedia).toBe(false);
    expect(report.flags[0].media).toEqual([]);
    // Straight at storage, too.
    const { data: signed } = await clients.viewer!.storage.from(BUCKET).createSignedUrls([`${co.orgId}/${attemptId}/screen/x.jpg`], 60);
    expect(signed?.[0]?.signedUrl ?? null).toBeNull();
  });

  it("lets a recruiter clear a flag with a note, and logs it", async () => {
    acting = clients.recruiter!;
    const fd = new FormData();
    fd.set("orgId", co.orgId);
    fd.set("flagId", flagId);
    fd.set("decision", "cleared");
    fd.set("note", "Share dropped when the laptop slept; candidate emailed us.");
    const state = await reviewFlag(undefined, fd);
    expect(state).toEqual({ message: "Flag cleared." });
    const flag = must(await db.from("flags").select("status, review_note, reviewed_by").eq("id", flagId).single());
    expect(flag).toEqual({ status: "cleared", review_note: "Share dropped when the laptop slept; candidate emailed us.", reviewed_by: co.users.recruiter.id });
    const log = must(await db.from("audit_log").select("action, target, actor_id").eq("org_id", co.orgId).eq("action", "cleared_flag"));
    expect(log).toEqual([{ action: "cleared_flag", target: flagId, actor_id: co.users.recruiter.id }]);
  });

  it("requires a note", async () => {
    acting = clients.admin!;
    const fd = new FormData();
    fd.set("orgId", co.orgId);
    fd.set("flagId", flagId);
    fd.set("decision", "confirmed");
    fd.set("note", "  ");
    const state = await reviewFlag(undefined, fd);
    expect(state?.fieldErrors?.note?.[0]).toBe("Add a short note explaining the decision.");
  });

  it("refuses viewers", async () => {
    acting = clients.viewer!;
    const fd = new FormData();
    fd.set("orgId", co.orgId);
    fd.set("flagId", flagId);
    fd.set("decision", "confirmed");
    fd.set("note", "looks bad");
    const state = await reviewFlag(undefined, fd);
    expect(state?.error).toBeTruthy();
    const flag = must(await db.from("flags").select("status").eq("id", flagId).single());
    expect(flag.status).toBe("cleared");
  });
});
