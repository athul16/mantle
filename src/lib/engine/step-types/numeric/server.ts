import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import { NUMERIC, numericAnswerSchema, type NumericAnswer, type NumericPublicConfig } from "./public";

/** Authored config. `prompt` may contain {{templates}}. */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    unit: z.string().optional(),
    decimals: z.number().int().min(0).max(6).default(2),
    points: z.number().positive().default(1),
  })
  .strict();
export type NumericConfig = z.infer<typeof configSchema>;

/**
 * Answer key from the scenario generator. Full credit within `tolerance`;
 * half credit within `partialTolerance` if set (e.g. a rounding slip).
 */
const keySchema = z
  .object({
    value: z.number().finite(),
    tolerance: z.number().min(0).default(0),
    partialTolerance: z.number().min(0).optional(),
  })
  .strict()
  .refine((k) => k.partialTolerance === undefined || k.partialTolerance >= k.tolerance, {
    message: "partialTolerance must be >= tolerance",
  });
export type NumericKey = z.infer<typeof keySchema>;

const fmt = (n: number, decimals: number) => n.toFixed(decimals);

export const numericServer: ServerStepType<NumericConfig, NumericPublicConfig, NumericAnswer, NumericKey> = {
  type: NUMERIC,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    return { prompt: fill(config.prompt), unit: config.unit, decimals: config.decimals };
  },

  parseAnswer(raw) {
    return numericAnswerSchema.parse(raw);
  },

  score({ config, key, answer }) {
    const max = config.points;
    const item = (earned: number, note: string) => ({
      points: earned,
      maxPoints: max,
      items: [{ id: "value", label: "Value", earned, max, note }],
    });

    if (answer === undefined || answer.value === null) {
      return item(0, `Not answered. Expected ${fmt(key.value, config.decimals)}.`);
    }
    const diff = Math.abs(answer.value - key.value);
    // Tiny epsilon so 0.1 + 0.2 style float noise never costs a candidate a point.
    const eps = 1e-9;
    if (diff <= key.tolerance + eps) {
      return item(max, `Correct (${fmt(answer.value, config.decimals)}).`);
    }
    if (key.partialTolerance !== undefined && diff <= key.partialTolerance + eps) {
      return item(
        max / 2,
        `Close: answered ${fmt(answer.value, config.decimals)}, expected ${fmt(key.value, config.decimals)}. Half credit.`,
      );
    }
    return item(0, `Answered ${fmt(answer.value, config.decimals)}, expected ${fmt(key.value, config.decimals)}.`);
  },
};
