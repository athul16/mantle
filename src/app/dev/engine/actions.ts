"use server";

import { z } from "zod";
import { demoPettyCash } from "@/lib/engine/scenarios/demo-petty-cash";
import { scoreAttempt } from "@/lib/engine/server/score";
import type { AttemptScore } from "@/lib/engine/types";

const inputSchema = z.object({
  seed: z.string().min(1).max(100),
  answers: z.record(z.string(), z.unknown()),
});

/** Dev-only: score the demo scenario for a seed. Server Actions are reachable by direct POST, so guard here too. */
export async function scoreDemoAttempt(seed: string, answers: Record<string, unknown>): Promise<AttemptScore> {
  if (process.env.NODE_ENV === "production") throw new Error("not available");
  const input = inputSchema.parse({ seed, answers });
  return scoreAttempt(demoPettyCash, input.seed, input.answers);
}
