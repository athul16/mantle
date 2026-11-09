"use server";

import { z } from "zod";
import { scoreAttempt } from "@/lib/engine/server/score";
import type { AttemptScore } from "@/lib/engine/types";
import { latestScenario } from "./scenarios";

const inputSchema = z.object({
  slug: z.string().min(1).max(100),
  seed: z.string().min(1).max(100),
  answers: z.record(z.string(), z.unknown()),
});

/** Dev-only: score a demo scenario for a seed. Server Actions are reachable by direct POST, so guard here too. */
export async function scoreDemoAttempt(
  slug: string,
  seed: string,
  answers: Record<string, unknown>,
): Promise<AttemptScore> {
  if (process.env.NODE_ENV === "production") throw new Error("not available");
  const input = inputSchema.parse({ slug, seed, answers });
  const scenario = latestScenario(input.slug);
  if (!scenario) throw new Error("unknown scenario");
  return scoreAttempt(scenario, input.seed, input.answers);
}
