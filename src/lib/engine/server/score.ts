import "server-only";

import type { AttemptScore, StepScore } from "../types";
import { getServerStepType } from "./registry";
import type { ServerScenario } from "./scenario";

/**
 * Validates one saved answer against its step type. Use on autosave so bad
 * shapes are rejected before they reach step_responses.
 */
export function parseAnswerForStep(scenario: ServerScenario, stepId: string, raw: unknown): unknown {
  const step = scenario.definition.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`scenario ${scenario.slug} has no step "${stepId}"`);
  return getServerStepType(step.type).parseAnswer(raw);
}

/**
 * Scores every step server-side against keys regenerated from the seed.
 * Missing answers score as unanswered; answers that fail validation score 0
 * with a note rather than aborting the whole attempt.
 */
export function scoreAttempt(scenario: ServerScenario, seed: string, answers: Record<string, unknown>): AttemptScore {
  const variant = scenario.generate(seed);
  const steps: Record<string, StepScore> = {};
  let points = 0;
  let maxPoints = 0;

  for (const step of scenario.definition.steps) {
    const stepType = getServerStepType(step.type);
    const config = stepType.configSchema.parse(step.config);
    const key = stepType.keySchema.parse(variant.keys[step.id]);

    let score: StepScore;
    const raw = answers[step.id];
    if (raw === undefined) {
      score = stepType.score({ config, key, variant, answer: undefined });
    } else {
      try {
        score = stepType.score({ config, key, variant, answer: stepType.parseAnswer(raw) });
      } catch {
        const zero = stepType.score({ config, key, variant, answer: undefined });
        score = {
          ...zero,
          points: 0,
          items: zero.items.map((i) => ({ ...i, earned: 0, note: "Saved answer was not in a valid format." })),
        };
      }
    }

    steps[step.id] = score;
    points += score.points;
    maxPoints += score.maxPoints;
  }

  return { points, maxPoints, steps };
}
