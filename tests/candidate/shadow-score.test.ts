/**
 * Shadow AI scoring after submit (D8, option B), against the local database
 * with a fake Claude client: no real API calls. Results land in
 * ai_shadow_scores only; scores are untouched; company users can't read them;
 * nothing ever throws.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MessagesClient } from "@/lib/engine/step-types/inbox_reply/ai-scorer";
import { createTestData, type TestCompany } from "../helpers/factories";
import { miniCloseJob, scoredAttempt } from "../helpers/results";
import { must, serviceClient, signedInClient } from "../helpers/supabase";

const afterSpy = vi.fn();
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => afterSpy(fn) }));

const { runShadowScoring, scheduleShadowScoring } = await import("@/lib/candidate/shadow-score");

const data = createTestData("shadow");
const db = serviceClient();
let co: TestCompany;
let jobId = "";
let scenarioId = "";

const usage = { input_tokens: 2100, output_tokens: 650, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const goodResponse = {
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  usage,
  parsed_output: {
    criteria: [
      { id: "timing", reasoning: "Says timing, names nothing.", earned: 1 },
      { id: "fee", reasoning: "Mentions the fee.", earned: 2 },
      { id: "balance", reasoning: "No balance.", earned: 0 },
      { id: "tone", reasoning: "Plain.", earned: 2 },
    ],
  },
};

function fakeClient(response: unknown | Error) {
  const parse = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: { messages: { parse } } as unknown as MessagesClient, parse };
}

async function attempt(answers?: Record<string, unknown>) {
  const a = await scoredAttempt(data, { orgId: co.orgId, jobId, scenarioId });
  if (answers) {
    for (const [stepId, answer] of Object.entries(answers)) {
      must(await db.from("step_responses").update({ answer: answer as never }).eq("attempt_id", a.attemptId).eq("step_id", stepId));
    }
  }
  return { id: a.attemptId, org_id: co.orgId, scenario_id: scenarioId };
}

const rows = async (attemptId: string) =>
  must(await db.from("ai_shadow_scores").select("*").eq("attempt_id", attemptId).order("id"));

beforeAll(async () => {
  co = await data.company();
  ({ jobId, scenarioId } = await miniCloseJob(data, co.orgId));
});

afterAll(() => data.cleanup());

describe("runShadowScoring", () => {
  it("scores each written reply and stores the result server-side, without touching the score", async () => {
    const a = await attempt();
    const before = must(await db.from("attempts").select("score, auto_score").eq("id", a.id).single());
    const { client, parse } = fakeClient(goodResponse);

    expect(await runShadowScoring(a, { client })).toEqual({ skipped: null, scored: 1, failed: 0, alreadyDone: 0 });
    expect(parse).toHaveBeenCalledOnce();
    // The request carries this candidate's reference facts, rebuilt from the seed.
    const sent = JSON.stringify(parse.mock.calls[0]);
    expect(sent).toContain("the two balances differ because of timing");
    expect(sent).toContain("<reference>");

    const [row] = await rows(a.id);
    expect(row).toMatchObject({
      org_id: co.orgId,
      step_id: "client-reply",
      model: "claude-sonnet-5-5",
      prompt_version: "inbox-reply-v1",
      status: "scored",
      points: 5,
      max_points: 9,
      stop_reason: "end_turn",
      error: null,
      input_tokens: 2100,
      output_tokens: 650,
      cache_read_input_tokens: 0,
    });
    expect(row.criteria).toEqual([
      { id: "timing", earned: 1, max: 3, reasoning: "Says timing, names nothing." },
      { id: "fee", earned: 2, max: 2, reasoning: "Mentions the fee." },
      { id: "balance", earned: 0, max: 2, reasoning: "No balance." },
      { id: "tone", earned: 2, max: 2, reasoning: "Plain." },
    ]);
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);

    // Never used in the score.
    expect(must(await db.from("attempts").select("score, auto_score").eq("id", a.id).single())).toEqual(before);

    // Running again doesn't call the API or add rows.
    const again = fakeClient(goodResponse);
    expect(await runShadowScoring(a, { client: again.client })).toMatchObject({ scored: 0, alreadyDone: 1 });
    expect(again.parse).not.toHaveBeenCalled();
    expect(await rows(a.id)).toHaveLength(1);
  });

  it("company users can't read the results, not even an admin", async () => {
    const a = await attempt();
    await runShadowScoring(a, { client: fakeClient(goodResponse).client });
    const admin = await signedInClient(co.users.admin.email, co.users.admin.password);
    const res = await admin.from("ai_shadow_scores").select("*").eq("attempt_id", a.id);
    expect(res.data ?? []).toHaveLength(0);
    expect(res.error?.code).toBe("42501");
  });

  it("skips quietly without an API key", async () => {
    const a = await attempt();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await runShadowScoring(a)).toMatchObject({ skipped: "no_api_key" });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY is not set"));
    info.mockRestore();
    expect(await rows(a.id)).toHaveLength(0);
  });

  it("stores a failed row when the API fails, and never throws", async () => {
    const a = await attempt();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient(new Error("connection reset"));
    expect(await runShadowScoring(a, { client })).toMatchObject({ scored: 0, failed: 1 });
    warn.mockRestore();
    expect(await rows(a.id)).toMatchObject([{ status: "failed", error: "Error: connection reset", criteria: [], points: null }]);
  });

  it("doesn't call the API for a blank reply", async () => {
    const a = await attempt({ "client-reply": { body: "   " } });
    const { client, parse } = fakeClient(goodResponse);
    expect(await runShadowScoring(a, { client })).toMatchObject({ skipped: "no_written_replies" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("never throws, even when the attempt can't be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runShadowScoring({ id: crypto.randomUUID(), org_id: co.orgId, scenario_id: scenarioId }, { client: fakeClient(goodResponse).client });
    expect(result.skipped).toBe("error");
    error.mockRestore();
  });
});

describe("scheduleShadowScoring", () => {
  it("does nothing without an API key", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    afterSpy.mockClear();
    scheduleShadowScoring({ id: crypto.randomUUID(), org_id: co.orgId, scenario_id: scenarioId });
    expect(afterSpy).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("runs after the response when a key is set, and survives having no request scope", () => {
    process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
    try {
      afterSpy.mockClear();
      scheduleShadowScoring({ id: crypto.randomUUID(), org_id: co.orgId, scenario_id: scenarioId });
      expect(afterSpy).toHaveBeenCalledOnce(); // the callback is not run here: it would call the API

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      afterSpy.mockImplementationOnce(() => {
        throw new Error("`after` was called outside a request scope");
      });
      expect(() => scheduleShadowScoring({ id: crypto.randomUUID(), org_id: co.orgId, scenario_id: scenarioId })).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
