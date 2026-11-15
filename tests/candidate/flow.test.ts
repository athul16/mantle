/**
 * Candidate flow against the local test database: invite link, email code,
 * attempt, autosave, deadline, submit and scoring. Creates its own company,
 * assessment, job and invites with the service key and deletes them after.
 * Codes are read from .dev-outbox (sendEmail's fallback without Resend).
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireDbEnv } from "../helpers/env";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));

// Local throwaway Supabase only (.env.test); see tests/helpers/env.ts.
requireDbEnv();
// Codes must land in .dev-outbox, never a real inbox.
delete process.env.RESEND_API_KEY;

const { generateToken, hashToken } = await import("@/lib/tokens");
const { publishScenario } = await import("@/lib/scenarios/publish");
const { requestCode, verifyCode } = await import("@/lib/candidate/code");
const { findInviteByToken, findAttemptForInvite } = await import("@/lib/candidate/invite");
const { getCandidateSession, sessionForToken } = await import("@/lib/candidate/session");
const { startAttempt, saveAnswer, submitAttempt, getWorkspaceView, recordClientEvent, getOpenedMessageIds } = await import(
  "@/lib/candidate/attempt"
);
const { SESSION_COOKIE, MAX_CODE_ATTEMPTS } = await import("@/lib/candidate/config");
const { demoPettyCash } = await import("@/lib/engine/scenarios/demo-petty-cash");
const codeRoute = await import("@/app/api/candidate/code/route");
const answerRoute = await import("@/app/api/candidate/answer/route");
const stateRoute = await import("@/app/api/candidate/state/route");
const verifyRoute = await import("@/app/api/candidate/verify/route");

const service = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomBytes(4).toString("hex");
const OUTBOX = path.join(process.cwd(), ".dev-outbox");
let orgId = "";
let jobId = "";
let assessmentId = "";
let scenarioId = "";
let inviteCount = 0;
const emails: string[] = [];

function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R["data"]>;
}

async function makeInvite(forJob = jobId) {
  inviteCount += 1;
  const email = `cand-${run}-${inviteCount}@example.test`;
  emails.push(email);
  const token = generateToken();
  const invite = must(
    await service
      .from("invites")
      .insert({ org_id: orgId, job_id: forJob, email, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .select("id")
      .single(),
  );
  must(await service.from("invite_secrets").insert({ invite_id: invite.id, org_id: orgId, token_hash: hashToken(token) }));
  return { token, email, inviteId: invite.id };
}

/** Latest code emailed to `email`, from .dev-outbox. */
async function readCode(email: string): Promise<string> {
  const safe = email.replace(/[^a-zA-Z0-9._-]/g, "_");
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith(`-${safe}.json`)).sort();
  expect(files.length).toBeGreaterThan(0);
  const mail = JSON.parse(await readFile(path.join(OUTBOX, files.at(-1)!), "utf8")) as { text: string };
  return /\b(\d{6})\b/.exec(mail.text)![1];
}

/** Link -> code -> verified session, timer started. */
async function verifiedCandidate(start = true) {
  const invite = await makeInvite();
  expect(await requestCode(invite.token)).toMatchObject({ ok: true });
  const result = await verifyCode({ token: invite.token, code: await readCode(invite.email), name: "Test Candidate", consent: true });
  if (!result.ok) throw new Error(`verify failed: ${result.error}`);
  const session = (await getCandidateSession(result.sessionToken))!;
  if (start) expect(await startAttempt(session)).toEqual({ ok: true });
  return { ...invite, sessionToken: result.sessionToken, attemptId: result.attemptId };
}

const fresh = async (sessionToken: string) => (await getCandidateSession(sessionToken))!;

function cookieRequest(url: string, sessionToken: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(new URL(url, "http://localhost:3102"), {
    method: init.method ?? "GET",
    headers: { cookie: `${SESSION_COOKIE}=${sessionToken}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function attemptRow(attemptId: string) {
  return must(await service.from("attempts").select("*").eq("id", attemptId).single());
}

async function seedFor(attemptId: string) {
  return must(await service.from("attempt_secrets").select("seed").eq("attempt_id", attemptId).single()).seed;
}

beforeAll(async () => {
  scenarioId = await publishScenario("demo-petty-cash", 1); // shared library row; never deleted here
  orgId = must(await service.from("organizations").insert({ name: `Candidate test ${run}`, slug: `cand-test-${run}` }).select("id").single()).id;
  assessmentId = must(
    await service
      .from("assessments")
      .insert({ org_id: orgId, scenario_id: scenarioId, title: "Petty cash", time_limit_minutes: 15 })
      .select("id")
      .single(),
  ).id;
  jobId = must(
    await service.from("jobs").insert({ org_id: orgId, title: "Audit intern", assessment_id: assessmentId }).select("id").single(),
  ).id;
});

afterAll(async () => {
  // Cascades to assessments, jobs, invites, secrets, attempts, responses and events.
  if (orgId) must(await service.from("organizations").delete().eq("id", orgId));
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  const safes = emails.map((e) => e.replace(/[^a-zA-Z0-9._-]/g, "_"));
  await Promise.all(files.filter((f) => safes.some((s) => f.endsWith(`-${s}.json`))).map((f) => rm(path.join(OUTBOX, f))));
});

describe("invite link", () => {
  it("opening the link uses nothing up", async () => {
    const invite = await makeInvite();
    const before = must(await service.from("invite_secrets").select("*").eq("invite_id", invite.inviteId).single());

    // What the landing page reads, twice (a link scanner, then the candidate).
    for (let i = 0; i < 2; i++) {
      const found = await findInviteByToken(invite.token);
      expect(found).toMatchObject({ inviteId: invite.inviteId, companyName: `Candidate test ${run}`, jobTitle: "Audit intern", timeLimitMinutes: 15 });
      expect(await findAttemptForInvite(invite.inviteId, orgId)).toBeNull();
    }

    const after = must(await service.from("invite_secrets").select("*").eq("invite_id", invite.inviteId).single());
    expect(after).toEqual(before);
    expect(must(await service.from("invites").select("status").eq("id", invite.inviteId).single()).status).toBe("invited");
    // Sending a code only happens on POST; the code route has no GET handler.
    expect("GET" in codeRoute).toBe(false);
    // And the token still works afterwards.
    expect(await requestCode(invite.token)).toMatchObject({ ok: true });
  });

  it("rejects unknown and malformed tokens", async () => {
    expect(await findInviteByToken(generateToken())).toBeNull();
    expect(await findInviteByToken("../../etc")).toBeNull();
    expect(await requestCode(generateToken())).toEqual({ ok: false, error: "invalid" });
  });
});

describe("email code", () => {
  it("locks after 5 wrong codes until a new code is sent", async () => {
    const invite = await makeInvite();
    expect(await requestCode(invite.token)).toMatchObject({ ok: true });
    expect(await requestCode(invite.token)).toEqual({ ok: false, error: "too_soon" });
    const code = await readCode(invite.email);
    const wrong = code === "000000" ? "111111" : "000000";
    const input = { token: invite.token, name: "Lockout Test", consent: true };

    for (let i = 1; i <= MAX_CODE_ATTEMPTS; i++) {
      const r = await verifyCode({ ...input, code: wrong });
      expect(r).toEqual({ ok: false, error: i < MAX_CODE_ATTEMPTS ? "wrong_code" : "locked", triesLeft: MAX_CODE_ATTEMPTS - i });
    }
    // Even the right code is refused now.
    expect(await verifyCode({ ...input, code })).toMatchObject({ ok: false, error: "locked" });
    expect(await findAttemptForInvite(invite.inviteId, orgId)).toBeNull();

    // A new code (after the resend gap) works.
    expect(await requestCode(invite.token, new Date(Date.now() + 31_000))).toMatchObject({ ok: true });
    const newCode = await readCode(invite.email);
    const ok = await verifyCode({ ...input, code: newCode });
    expect(ok).toMatchObject({ ok: true, resumed: false });
    // Codes are single use.
    expect(await verifyCode({ ...input, code: newCode })).toMatchObject({ ok: false, error: "no_code" });
  });

  it("requires consent and a name", async () => {
    const invite = await makeInvite();
    await requestCode(invite.token);
    const code = await readCode(invite.email);
    expect(await verifyCode({ token: invite.token, code, name: "No Consent", consent: false })).toEqual({ ok: false, error: "bad_input" });
    expect(await verifyCode({ token: invite.token, code, name: "  ", consent: true })).toEqual({ ok: false, error: "bad_input" });
  });

  it("verification creates the attempt, secrets, cookie, and locks the assessment", async () => {
    const invite = await makeInvite();
    await requestCode(invite.token);
    const form = new FormData();
    form.set("token", invite.token);
    form.set("code", await readCode(invite.email));
    form.set("name", "Cookie Test");
    form.set("consent", "on");
    const res = await verifyRoute.POST(new NextRequest("http://localhost:3102/api/candidate/verify", { method: "POST", body: form }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://localhost:3102/a/${invite.token}/check`);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.map((c) => /Path=([^;]+)/.exec(c)![1]).sort()).toEqual(["/a", "/api/candidate"]);
    for (const c of cookies) expect(c).toMatch(/HttpOnly/);

    const attempt = (await findAttemptForInvite(invite.inviteId, orgId))!;
    expect(attempt).toMatchObject({ status: "not_started", started_at: null });
    const inviteRow = must(await service.from("invites").select("status, candidate_name").eq("id", invite.inviteId).single());
    expect(inviteRow).toEqual({ status: "started", candidate_name: "Cookie Test" });
    expect(must(await service.from("assessments").select("locked_at").eq("id", assessmentId).single()).locked_at).not.toBeNull();
    const secret = must(await service.from("attempt_secrets").select("seed, session_token_hash").eq("attempt_id", attempt.id).single());
    const sessionToken = /ap_candidate=([^;]+)/.exec(cookies[0])![1];
    expect(secret.session_token_hash).toBe(hashToken(sessionToken));
    expect(secret.seed.length).toBeGreaterThan(20);
  });
});

describe("attempt", () => {
  it("autosaves answers and records events", async () => {
    const c = await verifiedCandidate();
    const req = (body: unknown) => cookieRequest("/api/candidate/answer", c.sessionToken, { method: "POST", body });

    expect((await answerRoute.POST(req({ stepId: "expected-cash", answer: { value: 100 } }))).status).toBe(200);
    expect((await answerRoute.POST(req({ stepId: "expected-cash", answer: { value: 123.45 } }))).status).toBe(200);
    const rows = must(await service.from("step_responses").select("step_id, answer").eq("attempt_id", c.attemptId));
    expect(rows).toEqual([{ step_id: "expected-cash", answer: { value: 123.45 } }]);

    // Bad shapes, unknown steps, and steps that haven't arrived yet are refused.
    const bad = await answerRoute.POST(req({ stepId: "expected-cash", answer: { value: "lots" } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "invalid_answer" });
    expect(await (await answerRoute.POST(req({ stepId: "nope", answer: { value: 1 } }))).json()).toMatchObject({ error: "unknown_step" });
    expect(await (await answerRoute.POST(req({ stepId: "shortage", answer: { value: 1 } }))).json()).toMatchObject({ error: "unknown_step" });

    // The shortage step arrives at minute 5 by the server clock.
    const session = await fresh(c.sessionToken);
    expect((await getWorkspaceView(session))!.steps.map((s) => s.id)).toEqual(["expected-cash"]);
    const later = new Date(Date.now() + 6 * 60_000);
    expect((await getWorkspaceView(session, later))!.steps.map((s) => s.id)).toEqual(["expected-cash", "shortage"]);
    expect(await saveAnswer(session, "shortage", { value: 5 }, later)).toMatchObject({ ok: true });

    const attemptRef = session.attempt;
    expect(await getOpenedMessageIds(attemptRef)).toEqual([]);
    expect(await recordClientEvent(session, "opened_message", { messageId: "m1" })).toBe(true);
    expect(await recordClientEvent(session, "opened_message", { messageId: "m1" })).toBe(true);
    // Read state for the workspace comes back from the events, once per message.
    expect(await getOpenedMessageIds(attemptRef)).toEqual(["m1"]);
    expect(await recordClientEvent(session, "integrity_cleared", { stepId: "x" })).toBe(false);
    const kinds = must(await service.from("action_events").select("kind").eq("attempt_id", c.attemptId)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["verified", "started_attempt", "saved_step", "opened_message"]));
    expect(kinds).not.toContain("integrity_cleared");
  });

  it("rejects saves after the deadline and submits as a timeout", async () => {
    const c = await verifiedCandidate();
    expect(await saveAnswer(await fresh(c.sessionToken), "expected-cash", { value: 1 })).toMatchObject({ ok: true });
    const past = new Date(Date.now() - 60_000).toISOString();
    must(await service.from("attempts").update({ deadline_at: past }).eq("id", c.attemptId));

    const res = await answerRoute.POST(
      cookieRequest("/api/candidate/answer", c.sessionToken, { method: "POST", body: { stepId: "expected-cash", answer: { value: 2 } } }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "time_up" });

    const row = await attemptRow(c.attemptId);
    expect(row).toMatchObject({ status: "scored", submit_reason: "timeout", submitted_at: expect.any(String) });
    expect(new Date(row.submitted_at!).getTime()).toBe(new Date(past).getTime());
    const saved = must(await service.from("step_responses").select("answer").eq("attempt_id", c.attemptId).single());
    expect(saved.answer).toEqual({ value: 1 });

    // A later submit can't turn it into the candidate's own submit.
    expect(await submitAttempt(await fresh(c.sessionToken))).toEqual({ ok: true, reason: "timeout" });
    expect((await attemptRow(c.attemptId)).submit_reason).toBe("timeout");
  });

  it("a submit after the deadline is recorded as a timeout", async () => {
    const c = await verifiedCandidate();
    must(await service.from("attempts").update({ deadline_at: new Date(Date.now() - 1000).toISOString() }).eq("id", c.attemptId));
    expect(await submitAttempt(await fresh(c.sessionToken))).toEqual({ ok: true, reason: "timeout" });
    // The state endpoint reports it as done, not in progress.
    const state = await (await stateRoute.GET(cookieRequest("/api/candidate/state", c.sessionToken))).json();
    expect(state).toEqual({ ok: true, status: "scored", submitReason: "timeout" });
  });

  it("scores on submit and stores per-step and total scores", async () => {
    const c = await verifiedCandidate();
    const keys = demoPettyCash.generate(await seedFor(c.attemptId)).keys as Record<string, { value: number }>;
    expect(await saveAnswer(await fresh(c.sessionToken), "expected-cash", { value: keys["expected-cash"].value })).toMatchObject({ ok: true });

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await submitAttempt(await fresh(c.sessionToken))).toEqual({ ok: true, reason: "candidate" });
    // D8 shadow scoring is scheduled after submit; with no API key (tests) it skips.
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`skipping attempt ${c.attemptId}`));
    info.mockRestore();

    const row = await attemptRow(c.attemptId);
    expect(row).toMatchObject({ status: "scored", submit_reason: "candidate" });
    expect(row.score).toMatchObject({ points: 2, maxPoints: 4 });
    const response = must(await service.from("step_responses").select("score, auto_score").eq("attempt_id", c.attemptId).eq("step_id", "expected-cash").single());
    expect(response.score).toMatchObject({ points: 2, maxPoints: 2 });
    // The automatic score is stored next to the final one (D11).
    expect(response.auto_score).toEqual(response.score);
    expect(must(await service.from("attempts").select("auto_score").eq("id", c.attemptId).single()).auto_score).toEqual(row.score);
    expect(must(await service.from("invites").select("status").eq("id", c.inviteId).single()).status).toBe("completed");

    // Done means done: no more saves, no new code.
    expect(await saveAnswer(await fresh(c.sessionToken), "expected-cash", { value: 0 })).toEqual({ ok: false, error: "submitted" });
    expect(await requestCode(c.token, new Date(Date.now() + 60_000))).toEqual({ ok: false, error: "completed" });
  });

  it("re-verifying resumes the same attempt and retires the old session", async () => {
    const c = await verifiedCandidate();
    const deadline = (await attemptRow(c.attemptId)).deadline_at;
    expect(await requestCode(c.token, new Date(Date.now() + 31_000))).toMatchObject({ ok: true });
    const again = await verifyCode({ token: c.token, code: await readCode(c.email), name: "Test Candidate", consent: true });
    expect(again).toMatchObject({ ok: true, resumed: true, attemptId: c.attemptId });
    expect(await getCandidateSession(c.sessionToken)).toBeNull();
    expect((await attemptRow(c.attemptId)).deadline_at).toBe(deadline);
  });
});

describe("isolation between candidates", () => {
  it("one candidate's cookie can't read or write another's attempt", async () => {
    const a = await verifiedCandidate();
    const b = await verifiedCandidate();

    // A's cookie on B's link: no session.
    expect(await sessionForToken(b.token, a.sessionToken)).toBeNull();
    expect((await sessionForToken(a.token, a.sessionToken))!.attempt.id).toBe(a.attemptId);

    // Naming B's attempt in the body changes nothing: the cookie decides.
    const res = await answerRoute.POST(
      cookieRequest("/api/candidate/answer", a.sessionToken, {
        method: "POST",
        body: { stepId: "expected-cash", answer: { value: 42 }, attemptId: b.attemptId, attempt_id: b.attemptId },
      }),
    );
    expect(res.status).toBe(200);
    expect(must(await service.from("step_responses").select("attempt_id").eq("attempt_id", b.attemptId))).toEqual([]);
    expect(must(await service.from("step_responses").select("attempt_id").eq("attempt_id", a.attemptId))).toHaveLength(1);

    // A's state shows A's answer and A's numbers, never B's.
    const state = await (await stateRoute.GET(cookieRequest("/api/candidate/state?attempt=" + b.attemptId, a.sessionToken))).json();
    expect(state.view.answers).toEqual({ "expected-cash": { value: 42 } });
    const aBody = state.view.messages.find((m: { id: string }) => m.id === "m1").body;
    const bView = (await getWorkspaceView(await fresh(b.sessionToken)))!;
    const bBody = bView.messages.find((m) => m.id === "m1")!.body;
    expect(aBody).not.toBe(bBody);
    expect(bView.answers).toEqual({});

    // No cookie, or a forged one: 401.
    expect((await stateRoute.GET(cookieRequest("/api/candidate/state", generateToken()))).status).toBe(401);
  });

});

describe("accommodations (D9)", () => {
  let proctoring: typeof import("@/lib/proctoring/server");
  let config: typeof import("@/lib/proctoring/config");
  let monitoredJob = "";

  beforeAll(async () => {
    proctoring = await import("@/lib/proctoring/server");
    config = await import("@/lib/proctoring/config");
    // A monitored assessment of its own: 20 minutes, camera and screen.
    const monitored = must(
      await service
        .from("assessments")
        .insert({ org_id: orgId, scenario_id: scenarioId, title: "Monitored", time_limit_minutes: 20, proctoring: { camera: true, screen: true } })
        .select("id")
        .single(),
    ).id;
    monitoredJob = must(
      await service.from("jobs").insert({ org_id: orgId, title: "Monitored intern", assessment_id: monitored }).select("id").single(),
    ).id;
  });

  async function candidateWith(accommodations: { extra_time_percent?: number; waive_camera?: boolean; waive_screen?: boolean }) {
    const invite = await makeInvite(monitoredJob);
    must(await service.from("invite_accommodations").insert({ invite_id: invite.inviteId, org_id: orgId, ...accommodations }));
    expect(await requestCode(invite.token)).toMatchObject({ ok: true });
    const result = await verifyCode({ token: invite.token, code: await readCode(invite.email), name: "Test Candidate", consent: true });
    if (!result.ok) throw new Error(`verify failed: ${result.error}`);
    return { ...invite, sessionToken: result.sessionToken, attemptId: result.attemptId };
  }

  it("extra time extends the server-enforced deadline", async () => {
    const c = await candidateWith({ extra_time_percent: 50 });
    const session = await fresh(c.sessionToken);
    expect(session.invite).toMatchObject({ baseTimeLimitMinutes: 20, timeLimitMinutes: 30 });

    const startedAt = new Date();
    expect(await startAttempt(session, startedAt)).toEqual({ ok: true });
    const row = await attemptRow(c.attemptId);
    const limitMs = new Date(row.deadline_at!).getTime() - new Date(row.started_at!).getTime();
    expect(limitMs).toBe(30 * 60_000);

    // Past the assessment's own 20 minutes the attempt is still open...
    const at25 = new Date(startedAt.getTime() + 25 * 60_000);
    expect(await getWorkspaceView(await fresh(c.sessionToken), at25)).not.toBeNull();
    expect((await attemptRow(c.attemptId)).status).toBe("in_progress");
    // ...and the server closes it at 30.
    const at31 = new Date(startedAt.getTime() + 31 * 60_000);
    expect(await getWorkspaceView(await fresh(c.sessionToken), at31)).toBeNull();
    const done = await attemptRow(c.attemptId);
    expect(done.submit_reason).toBe("timeout");
    expect(done.submitted_at).toBe(row.deadline_at);

    const started = must(
      await service.from("action_events").select("payload").eq("attempt_id", c.attemptId).eq("kind", "started_attempt").single(),
    );
    expect(started.payload).toMatchObject({ timeLimitMinutes: 30, accommodations: { extraTimePercent: 50, waiveCamera: false, waiveScreen: false } });
  });

  it("without accommodations the deadline is the assessment's limit", async () => {
    const invite = await makeInvite(monitoredJob);
    expect(await requestCode(invite.token)).toMatchObject({ ok: true });
    const result = await verifyCode({ token: invite.token, code: await readCode(invite.email), name: "Test Candidate", consent: true });
    if (!result.ok) throw new Error(result.error);
    expect(await startAttempt(await fresh(result.sessionToken))).toEqual({ ok: true });
    const row = await attemptRow(result.attemptId);
    expect(new Date(row.deadline_at!).getTime() - new Date(row.started_at!).getTime()).toBe(20 * 60_000);
  });

  it("a camera waiver skips the camera for that candidate only", async () => {
    const c = await candidateWith({ waive_camera: true });
    const session = await fresh(c.sessionToken);
    expect(await proctoring.getProctoringSettings(session)).toMatchObject({ camera: false, screen: true });
    expect(await proctoring.createSnapshotUpload(session, "camera")).toEqual({ ok: false, error: "not_enabled" });
    expect(await proctoring.createSnapshotUpload(session, "screen")).toMatchObject({ ok: true });

    // Another candidate on the same assessment is still asked for the camera.
    const other = await candidateWith({});
    expect(await proctoring.getProctoringSettings(await fresh(other.sessionToken))).toMatchObject({ camera: true, screen: true });
    // The assessment itself is unchanged (and locked).
    const job = must(await service.from("jobs").select("assessments(proctoring, locked_at)").eq("id", monitoredJob).single());
    expect(job.assessments).toMatchObject({ proctoring: { camera: true, screen: true } });
    expect(job.assessments?.locked_at).not.toBeNull();
  });

  it("the monitoring notice names the company contact", async () => {
    must(await service.from("organizations").update({ settings: { contact_email: "careers@example.test" } }).eq("id", orgId));
    const c = await candidateWith({});
    const session = await fresh(c.sessionToken);
    expect(session.invite.contactEmail).toBe("careers@example.test");
    const settings = await proctoring.getProctoringSettings(session);
    const notice = config.monitoringNotice(settings, session.invite.companyName).join("\n");
    expect(notice).toContain("careers@example.test");
    must(await service.from("organizations").update({ settings: {} }).eq("id", orgId));
  });
});
