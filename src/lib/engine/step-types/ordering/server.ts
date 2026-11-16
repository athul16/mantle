import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import { fillTemplate } from "../../server/template";
import type { StepScoreItem } from "../../types";
import {
  ITEM_ID_PATTERN,
  MAX_ITEMS,
  MIN_ITEMS,
  ORDERING,
  orderingAnswerSchema,
  orderingAnswerSchemaFor,
  type OrderingAnswer,
  type OrderingPublicConfig,
} from "./public";

/**
 * Authored config. The prompt, labels and details may contain {{templates}}.
 * Points are split into two optional parts: `positionPoints` for items in
 * their exact place, `pairwisePoints` for pairs in the right relative order.
 */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    items: z
      .array(
        z
          .object({ id: z.string().regex(ITEM_ID_PATTERN), label: z.string().min(1), detail: z.string().min(1).optional() })
          .strict(),
      )
      .min(MIN_ITEMS)
      .max(MAX_ITEMS)
      .refine((items) => new Set(items.map((i) => i.id)).size === items.length, { message: "item ids must be unique" }),
    positionPoints: z.number().nonnegative().default(0),
    pairwisePoints: z.number().nonnegative().default(0),
  })
  .strict()
  .refine((c) => c.positionPoints + c.pairwisePoints > 0, { message: "set positionPoints and/or pairwisePoints" });
export type OrderingConfig = z.infer<typeof configSchema>;

/** The right order: every item id once, first to last. */
const keySchema = z.object({ order: z.array(z.string().regex(ITEM_ID_PATTERN)).min(MIN_ITEMS).max(MAX_ITEMS) }).strict();
export type OrderingKey = z.infer<typeof keySchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const orderingServer: ServerStepType<OrderingConfig, OrderingPublicConfig, OrderingAnswer, OrderingKey> = {
  type: ORDERING,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    return {
      prompt: fill(config.prompt),
      items: config.items.map((i) => ({ id: i.id, label: fill(i.label), ...(i.detail ? { detail: fill(i.detail) } : {}) })),
    };
  },

  parseAnswer(raw) {
    return orderingAnswerSchema.parse(raw);
  },

  /**
   * Position part: positionPoints × (items in their exact place) ÷ items.
   * Pairwise part (Kendall-style): pairwisePoints × (pairs in the right
   * relative order) ÷ all pairs, so one swap of neighbours costs one pair.
   * Only parts worth points are listed. An answer that isn't every item
   * exactly once scores 0.
   */
  score({ config, key, variant, answer }) {
    const ids = config.items.map((i) => i.id);
    const known = new Set(ids);
    for (const id of key.order) if (!known.has(id)) throw new Error(`ordering key uses unknown item "${id}"`);
    if (key.order.length !== ids.length || new Set(key.order).size !== ids.length) throw new Error("ordering key must list every item exactly once");

    const label = (id: string) => {
      const raw = config.items.find((i) => i.id === id)!.label;
      try {
        return fillTemplate(raw, variant.values);
      } catch {
        return raw; // e.g. {{first_name}}, which isn't a variant value
      }
    };
    const expected = `Expected: ${key.order.map(label).join(" → ")}.`;
    const n = ids.length;
    const pairs = (n * (n - 1)) / 2;

    const parts = (inPlace: number, rightPairs: number, prefix?: string): StepScoreItem[] => {
      const perfect = inPlace === n;
      const tail = (s: string) => (prefix ? `${prefix} ${expected}` : perfect ? s : `${s} ${expected}`);
      const out: StepScoreItem[] = [];
      if (config.positionPoints > 0) {
        out.push({
          id: "positions",
          label: "Items in the right position",
          earned: round2((config.positionPoints * inPlace) / n),
          max: config.positionPoints,
          note: tail(`${inPlace} of ${n} items in the right position.`),
        });
      }
      if (config.pairwisePoints > 0) {
        out.push({
          id: "pairs",
          label: "Pairs in the right order",
          earned: round2((config.pairwisePoints * rightPairs) / pairs),
          max: config.pairwisePoints,
          note: tail(`${rightPairs} of ${pairs} pairs in the right relative order.`),
        });
      }
      return out;
    };
    const result = (items: StepScoreItem[]) => ({
      points: round2(items.reduce((s, i) => s + i.earned, 0)),
      maxPoints: config.positionPoints + config.pairwisePoints,
      items,
    });

    if (!answer) return result(parts(0, 0, "Not answered."));
    if (!orderingAnswerSchemaFor(ids).safeParse(answer).success) return result(parts(0, 0, "The answer didn't list every item exactly once."));

    const rank = new Map(key.order.map((id, i) => [id, i]));
    const ranks = answer.order.map((id) => rank.get(id)!);
    const inPlace = ranks.filter((r, i) => r === i).length;
    let rightPairs = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (ranks[i] < ranks[j]) rightPairs++;
    return result(parts(inPlace, rightPairs));
  },
};
