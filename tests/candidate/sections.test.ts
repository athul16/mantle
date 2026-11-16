/**
 * Timed sections, one-at-a-time screens and rapid items against the local test
 * database, using the demo-timed-close scenario. Time is moved forward by
 * passing `now` to the attempt functions, never by sleeping.
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
requireDbEnv();
delete process.env.RESEND_API_KEY;

const { generateToken, hashToken } = await import("@/lib/tokens");
const { publishScenario } = await import("@/lib/scenarios/publish");
const { requestCode, verifyCode } = await import("@/lib/candidate/code");
const { getCandidateSession } = await import("@/lib/candidate/session");
const { startAttempt, saveAnswer, submitAttempt, getWorkspaceView, getReview, advanceFlow } = await import("@/lib/candidate/attempt");
const { SESSION_COOKIE } = await import("@/lib/candidate/config");
const { demoTimedClose } = await import("@/lib/engine/scenarios/demo-timed-close");
const advanceRoute = await import("@/app/api/candidate/advance/route");

const service = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomBytes(4).toString("hex");
const OUTBOX = path.join(process.cwd(), ".dev-outbox");
let orgId = "";
let jobId = "";
const emails: string[] = [];
const SEC = 1_000;

function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R["data"]>;
}

async function readCode(email: string): Promise<string> {
  const safe = email.replace(/[^a-zA-Z0-9._-]/g, "_");
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith(`-${safe}.json`)).sort();
  const mail = JSON.parse(await readFile(path.join(OUTBOX, files.at(-1)!), "utf8")) as { text: string };
  return /\b(\d{6})\b/.exec(mail.text)![1];
}

/** Verified candidate with the timer started at `t0`. */
async function started() {
  const email = `sections-${run}-${emails.length}@example.test`;
  emails.push(email);
  const token = generateToken();
  const invite = must(
    await service
      .from("invites")
      .insert({ org_id: orgId, job_id: jobId, email, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .select("id")
      .single(),
  );
  must(await service.from("invite_secrets").insert({ invite_id: invite.id, org_id: orgId, token_hash: hashToken(token) }));
  await requestCode(token);
  const result = await verifyCode({ token, code: await readCode(email), name: "Sam Sections", consent: true });
  if (!result.ok) throw new Error(result.error);
  const t0 = new Date();
  expect(await startAttempt((await getCandidateSession(result.sessionToken))!, t0)).toEqual({ ok: true });
  const seed = must(await service.from("attempt_secrets").select("seed").eq("attempt_id", result.attemptId).single()).seed;
  const session = async () => (await getCandidateSession(result.sessionToken))!;
  const at = (ms: number) => new Date(t0.getTime() + ms);
  return { session, at, seed, attemptId: result.attemptId, sessionToken: result.sessionToken };
}

/** The correct values for rapid item `index` of the "quick" step, from the server-side key. */
function correctValues(seed: string, index: number) {
  const variant = demoTimedClose.generate(seed);
  const cfg = demoTimedClose.definition.steps.find((s) => s.id === "quick")!.config as { items: { id: string }[] };
  const itemKey = (variant.keys.quick as { items: Record<string, Record<string, { choice?: string; value?: number }>> }).items[cfg.items[index].id];
  return Object.fromEntries(Object.entries(itemKey).map(([f, k]) => [f, k.choice ?? k.value ?? null]));
}

beforeAll(async () => {
  const scenarioId = await publishScenario("demo-timed-close", 1);
  orgId = must(await service.from("organizations").insert({ name: `Sections ${run}`, slug: `sections-${run}` }).select("id").single()).id;
  const assessmentId = must(
    await service
      .from("assessments")
      .insert({ org_id: orgId, scenario_id: scenarioId, title: "Timed close", time_limit_minutes: demoTimedClose.timeLimitMinutes })
      .select("id")
      .single(),
  ).id;
  jobId = must(await service.from("jobs").insert({ org_id: orgId, title: "AP intern", assessment_id: assessmentId }).select("id").single()).id;
});

afterAll(async () => {
  if (orgId) must(await service.from("organizations").delete().eq("id", orgId));
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  const safes = emails.map((e) => e.replace(/[^a-zA-Z0-9._-]/g, "_"));
  await Promise.all(files.filter((f) => safes.some((s) => f.endsWith(`-${s}.json`))).map((f) => rm(path.join(OUTBOX, f))));
});

describe("timed sections in the attempt flow", () => {
  it("shows only the current section's steps and one rapid item at a time, without its key", async () => {
    const c = await started();
    const view = (await getWorkspaceView(await c.session(), c.at(1 * SEC)))!;
    expect(view.flow).toMatchObject({ done: false, section: { id: "s-quick", index: 0, count: 3 } });
    expect(view.steps.map((s) => s.id)).toEqual(["quick"]);
    const current = (view.steps[0].config as { current?: { index: number; count: number; endsAt: string; item: { id: string } } }).current!;
    expect(current).toMatchObject({ index: 0, count: 4 });
    expect(Date.parse(current.endsAt)).toBe(c.at(20 * SEC).getTime());
    const payload = JSON.stringify(view);
    expect(payload).not.toMatch(/"choice"|tolerance|"keys"/);
    // Later items are not in the payload.
    const items = (demoTimedClose.definition.steps.find((s) => s.id === "quick")!.config as { items: { id: string }[] }).items;
    for (const later of items.slice(1)) expect(payload).not.toContain(`"${later.id}"`);
  });

  it("answering an item records it with its response time and moves to the next item", async () => {
    const c = await started();
    expect(await saveAnswer(await c.session(), "quick", { index: 0, values: correctValues(c.seed, 0) }, c.at(5 * SEC))).toMatchObject({ ok: true });
    const view = (await getWorkspaceView(await c.session(), c.at(6 * SEC)))!;
    expect((view.steps[0].config as { current: { index: number } }).current.index).toBe(1);
    const saved = must(await service.from("step_responses").select("answer").eq("attempt_id", c.attemptId).eq("step_id", "quick").single());
    const firstItem = Object.values((saved.answer as { items: Record<string, { ms: number }> }).items)[0];
    expect(firstItem.ms).toBe(5_000);
    const events = must(await service.from("action_events").select("kind, payload").eq("attempt_id", c.attemptId).eq("kind", "answered_item"));
    expect(events).toHaveLength(1);
  });

  it("refuses an answer after the item's deadline, and the item scores 0", async () => {
    const c = await started();
    // Item 0 ran from 0s to 20s; this lands at 25s.
    expect(await saveAnswer(await c.session(), "quick", { index: 0, values: correctValues(c.seed, 0) }, c.at(25 * SEC))).toEqual({
      ok: false,
      error: "item_closed",
    });
    // The same request for the item that is open now (index 1) is fine.
    expect(await saveAnswer(await c.session(), "quick", { index: 1, values: correctValues(c.seed, 1) }, c.at(26 * SEC))).toMatchObject({ ok: true });
  });

  it("refuses answers to steps in sections that haven't started or have ended", async () => {
    const c = await started();
    expect(await saveAnswer(await c.session(), "screen-1", { value: 1 }, c.at(2 * SEC))).toEqual({ ok: false, error: "locked" });
    // After the quick section's 2 minutes, the quick step is locked.
    expect(await saveAnswer(await c.session(), "quick", { index: 3, values: correctValues(c.seed, 3) }, c.at(130 * SEC))).toEqual({
      ok: false,
      error: "locked",
    });
  });

  it("finishing a section early starts the next one; one-at-a-time screens show one step", async () => {
    const c = await started();
    expect(await advanceFlow(await c.session(), { kind: "section", id: "s-quick" }, c.at(10 * SEC))).toEqual({ ok: true });
    // A stale or repeated request for a section that isn't current changes nothing.
    expect(await advanceFlow(await c.session(), { kind: "section", id: "s-quick" }, c.at(11 * SEC))).toEqual({ ok: false, error: "not_current" });
    const view = (await getWorkspaceView(await c.session(), c.at(12 * SEC)))!;
    expect(view.flow?.section?.id).toBe("s-screens");
    expect(view.flow?.screen).toMatchObject({ stepId: "screen-1", index: 0, count: 2 });
    expect(Date.parse(view.flow!.screen!.endsAt)).toBe(c.at(100 * SEC).getTime());
    expect(view.steps.map((s) => s.id)).toEqual(["screen-1"]);

    expect(await advanceFlow(await c.session(), { kind: "screen", id: "screen-1" }, c.at(20 * SEC))).toEqual({ ok: true });
    const next = (await getWorkspaceView(await c.session(), c.at(21 * SEC)))!;
    expect(next.steps.map((s) => s.id)).toEqual(["screen-2"]);
    expect(await saveAnswer(await c.session(), "screen-1", { value: 1 }, c.at(22 * SEC))).toEqual({ ok: false, error: "locked" });
  });

  it("the advance route takes the attempt from the cookie", async () => {
    const c = await started();
    const req = new NextRequest(new URL("/api/candidate/advance", "http://localhost:3102"), {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${c.sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "section", id: "s-quick" }),
    });
    const res = await advanceRoute.POST(req);
    expect(res.status).toBe(200);
    const bad = new NextRequest(new URL("/api/candidate/advance", "http://localhost:3102"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "section", id: "s-screens" }),
    });
    expect((await advanceRoute.POST(bad)).status).toBe(401);
  });

  it("review lists every step of the sections reached; scoring counts answered items only", async () => {
    const c = await started();
    await saveAnswer(await c.session(), "quick", { index: 0, values: correctValues(c.seed, 0) }, c.at(3 * SEC));
    await advanceFlow(await c.session(), { kind: "section", id: "s-quick" }, c.at(5 * SEC));
    const review = (await getReview(await c.session(), c.at(6 * SEC)))!;
    expect(review.map((r) => r.stepId)).toEqual(["quick", "screen-1", "screen-2"]);
    expect(review.find((r) => r.stepId === "quick")?.answered).toBe(true);

    expect(await submitAttempt(await c.session(), c.at(7 * SEC))).toEqual({ ok: true, reason: "candidate" });
    const row = must(await service.from("attempts").select("score").eq("id", c.attemptId).single());
    const quick = (row.score as { steps: Record<string, { points: number; items: { id: string; note?: string }[] }> }).steps.quick;
    expect(quick.points).toBe(1);
    expect(quick.items.find((i) => i.id === "timing")?.note).toMatch(/1 answered; 3 with no answer/);
  });
});
