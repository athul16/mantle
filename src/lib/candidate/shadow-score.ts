import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import type { Json } from "@/lib/database.types";
import { rubricRequestsForAttempt } from "@/lib/engine/server/rubric-requests";
import {
  PROMPT_VERSION,
  SHADOW_MODEL,
  scoreReplyWithClaude,
  type MessagesClient,
} from "@/lib/engine/step-types/inbox_reply/ai-scorer";
import { createServiceClient } from "@/lib/supabase/service";
import { loadScenario } from "./scenario";

/**
 * Shadow AI scoring (decision D8, option B). After an attempt is submitted,
 * every written reply is scored by Claude against the rubric and the result
 * goes to `ai_shadow_scores`, a table only the service role can read. It is
 * never shown to anyone in the app and never touches `score` or `auto_score`.
 * The point is to measure AI vs human agreement per criterion
 * (private.ai_shadow_agreement) before deciding on AI suggestions (D8 C).
 *
 * It runs after the submit response (E6) and can never fail or slow the
 * submission: without ANTHROPIC_API_KEY it logs and does nothing, and every
 * error is caught and logged (without candidate content).
 */

type AttemptRef = { id: string; org_id: string; scenario_id: string };

const LOG = "[shadow-score]";

/** Schedules shadow scoring to run after the current response. Never throws. */
export function scheduleShadowScoring(attempt: AttemptRef): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.info(`${LOG} ANTHROPIC_API_KEY is not set; skipping attempt ${attempt.id}`);
    return;
  }
  try {
    after(() => runShadowScoring(attempt));
  } catch (err) {
    // Outside a request (scripts, tests) there is no "after"; skip rather than block.
    console.warn(`${LOG} could not schedule attempt ${attempt.id}:`, err instanceof Error ? err.message : err);
  }
}

export type ShadowRunSummary = { skipped: string | null; scored: number; failed: number; alreadyDone: number };

/**
 * Scores every non-blank inbox_reply of a submitted attempt and stores the
 * results. Steps already stored for this model and prompt version are
 * skipped, so it is safe to run again. Never throws.
 */
export async function runShadowScoring(
  attempt: AttemptRef,
  deps: { client?: MessagesClient; apiKey?: string } = {},
): Promise<ShadowRunSummary> {
  const summary: ShadowRunSummary = { skipped: null, scored: 0, failed: 0, alreadyDone: 0 };
  try {
    const apiKey = deps.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!deps.client && !apiKey) {
      console.info(`${LOG} ANTHROPIC_API_KEY is not set; skipping attempt ${attempt.id}`);
      return { ...summary, skipped: "no_api_key" };
    }

    const db = createServiceClient();
    const [scenario, seedRow, answerRows, existing] = await Promise.all([
      loadScenario(attempt.scenario_id),
      db.from("attempt_secrets").select("seed").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).single(),
      db.from("step_responses").select("step_id, answer").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id),
      db
        .from("ai_shadow_scores")
        .select("step_id")
        .eq("attempt_id", attempt.id)
        .eq("org_id", attempt.org_id)
        .eq("model", SHADOW_MODEL)
        .eq("prompt_version", PROMPT_VERSION),
    ]);
    for (const r of [seedRow, answerRows, existing]) if (r.error) throw new Error(r.error.message);

    const answers = Object.fromEntries((answerRows.data ?? []).map((r) => [r.step_id, r.answer as unknown]));
    const done = new Set((existing.data ?? []).map((r) => r.step_id));
    const requests = rubricRequestsForAttempt(scenario, seedRow.data!.seed, answers);
    const todo = requests.filter((r) => !done.has(r.stepId));
    summary.alreadyDone = requests.length - todo.length;
    if (!todo.length) return { ...summary, skipped: requests.length ? null : "no_written_replies" };

    const client = deps.client ?? new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });

    await Promise.all(
      todo.map(async ({ stepId, request }) => {
        const started = Date.now();
        const result = await scoreReplyWithClaude(client, request);
        const { error } = await db.from("ai_shadow_scores").upsert(
          {
            attempt_id: attempt.id,
            org_id: attempt.org_id,
            step_id: stepId,
            model: SHADOW_MODEL, // the model id requested (no fallback model is configured)
            prompt_version: result.promptVersion,
            status: result.status,
            criteria: result.criteria as unknown as Json,
            points: result.points,
            max_points: result.maxPoints,
            stop_reason: result.stopReason,
            error: result.error,
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
            cache_read_input_tokens: result.usage.cacheReadInputTokens,
            cache_creation_input_tokens: result.usage.cacheCreationInputTokens,
            duration_ms: Date.now() - started,
          },
          { onConflict: "attempt_id,step_id,model,prompt_version", ignoreDuplicates: true },
        );
        if (error) throw new Error(`storing shadow score failed: ${error.message}`);
        if (result.status === "scored") summary.scored++;
        else {
          summary.failed++;
          console.warn(`${LOG} attempt ${attempt.id} step ${stepId} failed: ${result.error}`);
        }
      }),
    );
    console.info(`${LOG} attempt ${attempt.id}: ${summary.scored} scored, ${summary.failed} failed`);
  } catch (err) {
    console.error(`${LOG} attempt ${attempt.id} aborted:`, err instanceof Error ? err.message : err);
    return { ...summary, skipped: summary.skipped ?? "error" };
  }
  return summary;
}
