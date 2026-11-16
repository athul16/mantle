import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import {
  MAX_OPTIONS,
  MULTIPLE_CHOICE,
  OPTION_ID_PATTERN,
  multipleChoiceAnswerSchema,
  type MultipleChoiceAnswer,
  type MultipleChoicePublicConfig,
} from "./public";

/** Authored config. The prompt and option labels may contain {{templates}}. */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    options: z
      .array(z.object({ id: z.string().regex(OPTION_ID_PATTERN), label: z.string().min(1) }).strict())
      .min(2)
      .max(MAX_OPTIONS)
      .refine((o) => new Set(o.map((x) => x.id)).size === o.length, { message: "option ids must be unique" }),
    select: z.enum(["single", "multi"]).default("single"),
    points: z.number().positive().default(1),
  })
  .strict();
export type MultipleChoiceConfig = z.infer<typeof configSchema>;

/** The right option ids: exactly one for "single", one or more for "multi". */
const keySchema = z.object({ correct: z.array(z.string().regex(OPTION_ID_PATTERN)).min(1) }).strict();
export type MultipleChoiceKey = z.infer<typeof keySchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const multipleChoiceServer: ServerStepType<
  MultipleChoiceConfig,
  MultipleChoicePublicConfig,
  MultipleChoiceAnswer,
  MultipleChoiceKey
> = {
  type: MULTIPLE_CHOICE,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    return { prompt: fill(config.prompt), options: config.options.map((o) => ({ id: o.id, label: fill(o.label) })), select: config.select };
  },

  parseAnswer(raw) {
    return multipleChoiceAnswerSchema.parse(raw);
  },

  /**
   * single: full points for exactly the right option, else 0.
   * multi: each right option picked earns points / (right options); each
   * wrong option picked costs points / (wrong options), so picking every
   * option earns 0. Floored at 0.
   */
  score({ config, key, answer }) {
    const ids = new Set(config.options.map((o) => o.id));
    for (const c of key.correct) if (!ids.has(c)) throw new Error(`multiple_choice key uses unknown option "${c}"`);
    if (new Set(key.correct).size !== key.correct.length) throw new Error("multiple_choice key options must be unique");
    if (config.select === "single" && key.correct.length !== 1) throw new Error("multiple_choice single select needs exactly one correct option");

    const label = (id: string) => `"${config.options.find((o) => o.id === id)!.label}"`;
    const expected = `Expected ${key.correct.map(label).join(", ")}.`;
    const max = config.points;
    const item = (earned: number, note: string) => ({
      points: earned,
      maxPoints: max,
      items: [{ id: "answer", label: "Answer", earned, max, note }],
    });

    const picked = (answer?.selected ?? []).filter((id) => ids.has(id));
    if (picked.length === 0) return item(0, `Not answered. ${expected}`);

    const correct = new Set(key.correct);
    if (config.select === "single") {
      const ok = picked.length === 1 && correct.has(picked[0]);
      return item(ok ? max : 0, ok ? `Chose ${label(picked[0])}.` : `Chose ${picked.map(label).join(", ")}. ${expected}`);
    }

    const right = picked.filter((id) => correct.has(id));
    const wrong = picked.filter((id) => !correct.has(id));
    const nWrongOptions = config.options.length - correct.size;
    const share = right.length / correct.size - (nWrongOptions > 0 ? wrong.length / nWrongOptions : 0);
    const earned = round2(Math.max(0, share) * max);
    const wrongText = wrong.length ? `${wrong.length} wrong pick${wrong.length === 1 ? "" : "s"} (${wrong.map(label).join(", ")})` : "no wrong picks";
    const note =
      right.length === correct.size && !wrong.length
        ? `All ${correct.size} right options, no wrong picks.`
        : `${right.length} of ${correct.size} right options, ${wrongText}. ${expected}`;
    return item(earned, note);
  },
};
