import "server-only";

import { z } from "zod";
import type { PublicContext, ServerStepType } from "../../server/step-type";
import type { StepScoreItem } from "../../types";
import {
  RAPID_ROUND,
  rapidItemSubmissionSchema,
  rapidRoundAnswerSchema,
  type RapidField,
  type RapidItem,
  type RapidRoundAnswer,
  type RapidRoundPublicConfig,
} from "./public";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const fieldSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id,
      label: z.string().min(1),
      kind: z.literal("choice"),
      options: z.array(z.object({ id, label: z.string().min(1) }).strict()).min(2),
    })
    .strict(),
  z
    .object({
      id,
      label: z.string().min(1),
      kind: z.literal("number"),
      unit: z.string().optional(),
      decimals: z.number().int().min(0).max(6).default(2),
    })
    .strict(),
]);

const itemSchema = z
  .object({
    id,
    /** May contain {{templates}}, as may every exhibit text. */
    prompt: z.string().min(1),
    exhibit: z
      .object({
        title: z.string().optional(),
        rows: z.array(z.object({ label: z.string(), value: z.string() }).strict()).optional(),
        table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).strict().optional(),
      })
      .strict()
      .optional(),
    fields: z.array(fieldSchema).min(1),
    points: z.number().positive().default(1),
  })
  .strict()
  .refine((i) => new Set(i.fields.map((f) => f.id)).size === i.fields.length, { message: "field ids must be unique" });

/** Authored config. Items are never sent as a list; see `sequence.renderItem`. */
const configSchema = z
  .object({
    intro: z.string(),
    secondsPerItem: z.number().int().min(5).max(600).default(20),
    items: z.array(itemSchema).min(1).max(50),
  })
  .strict()
  .refine((c) => new Set(c.items.map((i) => i.id)).size === c.items.length, { message: "item ids must be unique" })
  .refine((c) => !c.items.some((i) => i.id === "timing"), { message: 'item id "timing" is reserved for the timing line' });
export type RapidRoundConfig = z.infer<typeof configSchema>;

/** Per item, per field: the right option, or the right number within `tolerance`. */
const keySchema = z
  .object({
    items: z.record(
      z.string(),
      z.record(
        z.string(),
        z.union([
          z.object({ choice: z.string() }).strict(),
          z.object({ value: z.number().finite(), tolerance: z.number().min(0).default(0) }).strict(),
        ]),
      ),
    ),
  })
  .strict();
export type RapidRoundKey = z.infer<typeof keySchema>;

type ConfigItem = RapidRoundConfig["items"][number];
type ConfigField = ConfigItem["fields"][number];

function publicField(f: ConfigField, fill: (s: string) => string): RapidField {
  if (f.kind === "number") {
    return { id: f.id, label: fill(f.label), kind: "number", ...(f.unit !== undefined ? { unit: f.unit } : {}), decimals: f.decimals };
  }
  // No `kind` for choices: see RapidChoiceField.
  return { id: f.id, label: fill(f.label), options: f.options.map((o) => ({ id: o.id, label: fill(o.label) })) };
}

function renderItem(item: ConfigItem, { fill }: PublicContext): RapidItem {
  const ex = item.exhibit;
  return {
    id: item.id,
    prompt: fill(item.prompt),
    ...(ex
      ? {
          exhibit: {
            ...(ex.title !== undefined ? { title: fill(ex.title) } : {}),
            ...(ex.rows ? { rows: ex.rows.map((r) => ({ label: fill(r.label), value: fill(r.value) })) } : {}),
            ...(ex.table ? { table: { columns: ex.table.columns.map(fill), rows: ex.table.rows.map((r) => r.map(fill)) } } : {}),
          },
        }
      : {}),
    fields: item.fields.map((f) => publicField(f, fill)),
  };
}

/** Checks one item's values against its fields: every field filled, known options, real numbers. */
function checkValues(item: ConfigItem, values: Record<string, string | number>) {
  const fields = new Map(item.fields.map((f) => [f.id, f]));
  for (const fieldId of Object.keys(values)) if (!fields.has(fieldId)) throw new Error(`unknown field "${fieldId}"`);
  for (const f of item.fields) {
    const v = values[f.id];
    if (f.kind === "choice") {
      if (typeof v !== "string" || !f.options.some((o) => o.id === v)) throw new Error(`field "${f.id}" needs one of its options`);
    } else if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`field "${f.id}" needs a number`);
    }
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const rapidRoundServer: ServerStepType<RapidRoundConfig, RapidRoundPublicConfig, RapidRoundAnswer, RapidRoundKey> = {
  type: RAPID_ROUND,
  configSchema,
  keySchema,

  // Only the count and timing: items arrive one at a time as `current`.
  toPublic(config, { fill }) {
    return { intro: fill(config.intro), itemCount: config.items.length, secondsPerItem: config.secondsPerItem };
  },

  parseAnswer(raw) {
    return rapidRoundAnswerSchema.parse(raw);
  },

  sequence: {
    count: (config) => config.items.length,
    secondsPerItem: (config) => config.secondsPerItem,
    renderItem(config, ctx, index) {
      const item = config.items[index];
      if (!item) throw new Error(`no item ${index}`);
      return renderItem(item, ctx);
    },
    recordItem(config, prev, index, raw, ms) {
      const submission = rapidItemSubmissionSchema.parse(raw);
      if (submission.index !== index) throw new Error(`answer is for item ${submission.index}, not ${index}`);
      const item = config.items[index];
      if (!item) throw new Error(`no item ${index}`);
      if (prev?.items[item.id]) throw new Error(`item ${index} already has an answer`);
      checkValues(item, submission.values);
      return { items: { ...(prev?.items ?? {}), [item.id]: { values: submission.values, ms: Math.max(0, Math.round(ms)) } } };
    },
  },

  score({ config, key, answer }) {
    const items: StepScoreItem[] = [];
    const times: number[] = [];
    let unanswered = 0;

    config.items.forEach((item, i) => {
      const label = `Item ${i + 1}`;
      const given = answer?.items[item.id];
      if (!given) {
        unanswered++;
        items.push({ id: item.id, label, earned: 0, max: item.points, note: "No answer (timed out or skipped)." });
        return;
      }
      times.push(given.ms);
      const itemKey = key.items[item.id] ?? {};
      const misses: string[] = [];
      let right = 0;
      for (const f of item.fields) {
        const k = itemKey[f.id];
        const v = given.values[f.id];
        let ok = false;
        let expected = "?";
        if (k && "choice" in k) {
          ok = v === k.choice;
          expected = f.kind === "choice" ? (f.options.find((o) => o.id === k.choice)?.label ?? k.choice) : k.choice;
        } else if (k) {
          ok = typeof v === "number" && Math.abs(v - k.value) <= k.tolerance + 1e-9;
          expected = k.value.toFixed(f.kind === "number" ? f.decimals : 2);
        }
        if (ok) right++;
        else misses.push(`${f.label}: expected ${expected}`);
      }
      const earned = (item.points * right) / item.fields.length;
      const note =
        right === item.fields.length
          ? `Correct in ${seconds(given.ms)}.`
          : `${right} of ${item.fields.length} right in ${seconds(given.ms)}. ${misses.join("; ")}.`;
      items.push({ id: item.id, label, earned, max: item.points, note });
    });

    const timing = times.length
      ? `Median response ${seconds(median(times))} over ${times.length} answered; ${unanswered} with no answer.`
      : `No items answered; ${unanswered} with no answer.`;
    items.push({ id: "timing", label: "Response time", earned: 0, max: 0, note: timing });

    return {
      points: items.reduce((sum, x) => sum + x.earned, 0),
      maxPoints: config.items.reduce((sum, x) => sum + x.points, 0),
      items,
    };
  },
};
