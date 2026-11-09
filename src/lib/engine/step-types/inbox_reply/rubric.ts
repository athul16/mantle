import "server-only";

import type { StepScore } from "../../types";

/**
 * Seam for a future AI (or other automatic) rubric scorer. Nothing calls a
 * model yet: `inbox_reply` scores 0 provisional points with `needsReview`, and
 * a person marks it. When a scorer exists, it runs after submit (outside
 * scoreAttempt, which stays synchronous) and its output goes through
 * `applyRubricResults`, which still marks the step for human review.
 */

export interface RubricCriterion {
  id: string;
  label: string;
  maxPoints: number;
  /** What a good answer does for this criterion, with variant values filled in. */
  guidance: string;
  /** Variant-specific facts for this criterion (e.g. the correct balance), from the answer key. */
  reference?: string;
}

export interface RubricScoreRequest {
  /** The task as the candidate saw it. */
  prompt: string;
  reply: string;
  criteria: RubricCriterion[];
}

export interface RubricCriterionResult {
  id: string;
  earned: number;
  /** Why the scorer gave these points; shown to the reviewer. */
  reasoning: string;
}

export interface RubricScorer {
  scoreReply(request: RubricScoreRequest): Promise<RubricCriterionResult[]>;
}

/**
 * Turns scorer output into a StepScore. Points are clamped to each
 * criterion's range; a criterion the scorer skipped scores 0 with a note.
 * Always `needsReview`: a person confirms or overrides (docs/06).
 */
export function applyRubricResults(criteria: RubricCriterion[], results: RubricCriterionResult[]): StepScore {
  const known = new Set(criteria.map((c) => c.id));
  for (const r of results) {
    if (!known.has(r.id)) throw new Error(`rubric result for unknown criterion "${r.id}"`);
  }
  const byId = new Map(results.map((r) => [r.id, r]));

  const items = criteria.map((c) => {
    const r = byId.get(c.id);
    if (!r) return { id: c.id, label: c.label, earned: 0, max: c.maxPoints, note: "Not scored automatically." };
    const earned = Number.isFinite(r.earned) ? Math.min(c.maxPoints, Math.max(0, r.earned)) : 0;
    return { id: c.id, label: c.label, earned, max: c.maxPoints, note: r.reasoning };
  });

  return {
    points: items.reduce((sum, i) => sum + i.earned, 0),
    maxPoints: items.reduce((sum, i) => sum + i.max, 0),
    items,
    needsReview: true,
  };
}
