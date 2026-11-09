import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import { fillTemplate } from "../../server/template";
import {
  INBOX_REPLY,
  INBOX_REPLY_MAX_CHARS,
  inboxReplyAnswerSchema,
  type InboxReplyAnswer,
  type InboxReplyPublicConfig,
} from "./public";
import type { RubricCriterion, RubricScoreRequest } from "./rubric";

const criterionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
    label: z.string().min(1),
    maxPoints: z.number().positive(),
    /** For the reviewer (and a future AI scorer). May contain {{templates}}. Never sent to the browser. */
    guidance: z.string().min(1),
  })
  .strict();

/** Authored config. `prompt`, `to` and `subject` may contain {{templates}}. */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    to: z.string().optional(),
    subject: z.string().optional(),
    maxChars: z.number().int().positive().max(INBOX_REPLY_MAX_CHARS).default(5_000),
    criteria: z.array(criterionSchema).min(1),
  })
  .strict()
  .refine((c) => new Set(c.criteria.map((x) => x.id)).size === c.criteria.length, {
    message: "criterion ids must be unique",
  });
export type InboxReplyConfig = z.infer<typeof configSchema>;

/**
 * Optional per-variant facts for the reviewer, keyed by criterion id (e.g.
 * "Adjusted balance is $18,970.00"). Produced by the scenario generator from
 * the same numbers as the candidate's material.
 */
const keySchema = z
  .object({
    notes: z.record(z.string(), z.string()).default({}),
  })
  .strict()
  .default({ notes: {} });
export type InboxReplyKey = z.infer<typeof keySchema>;

/** Criteria with guidance filled from the variant and reference facts attached. Server only. */
export function rubricCriteria(config: InboxReplyConfig, key: InboxReplyKey, values: Record<string, string | number>) {
  const ids = new Set(config.criteria.map((c) => c.id));
  for (const id of Object.keys(key.notes)) {
    if (!ids.has(id)) throw new Error(`inbox_reply key has a note for unknown criterion "${id}"`);
  }
  return config.criteria.map(
    (c): RubricCriterion => ({
      id: c.id,
      label: c.label,
      maxPoints: c.maxPoints,
      guidance: fillTemplate(c.guidance, values),
      reference: key.notes[c.id],
    }),
  );
}

/** What a future RubricScorer would receive for this answer. */
export function rubricRequest(
  config: InboxReplyConfig,
  key: InboxReplyKey,
  values: Record<string, string | number>,
  answer: InboxReplyAnswer,
): RubricScoreRequest {
  return {
    prompt: fillTemplate(config.prompt, values),
    reply: answer.body,
    criteria: rubricCriteria(config, key, values),
  };
}

export const inboxReplyServer: ServerStepType<InboxReplyConfig, InboxReplyPublicConfig, InboxReplyAnswer, InboxReplyKey> = {
  type: INBOX_REPLY,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    return {
      prompt: fill(config.prompt),
      to: config.to === undefined ? undefined : fill(config.to),
      subject: config.subject === undefined ? undefined : fill(config.subject),
      maxChars: config.maxChars,
    };
  },

  parseAnswer(raw) {
    return inboxReplyAnswerSchema.parse(raw);
  },

  /**
   * No automatic marking yet: a written reply gets 0 provisional points per
   * criterion and `needsReview`, with the guidance in each note for the
   * reviewer. A blank reply is final at 0 (nothing to review).
   */
  score({ config, key, variant, answer }) {
    const criteria = rubricCriteria(config, key, variant.values);
    const blank = answer === undefined || answer.body.trim() === "";

    const items = criteria.map((c) => ({
      id: c.id,
      label: c.label,
      earned: 0,
      max: c.maxPoints,
      note: blank
        ? "Not answered."
        : `Needs review. Look for: ${c.guidance}${c.reference ? ` Reference: ${c.reference}` : ""}`,
    }));

    return {
      points: 0,
      maxPoints: items.reduce((sum, i) => sum + i.max, 0),
      items,
      needsReview: !blank,
    };
  },
};
