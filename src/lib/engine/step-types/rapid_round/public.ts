/**
 * `rapid_round` step type, browser-safe part: quick items shown one at a
 * time, each with its own countdown. The browser only ever gets the current
 * item (injected by the attempt flow as `current`), never the list. No answer
 * key here.
 */
import { z } from "zod";

export const RAPID_ROUND = "rapid_round";

/**
 * A pick-one field. Sent without `kind` (anything with `options` is a choice):
 * the key stores choices under `choice`, and the leak tests look for that word.
 */
export interface RapidChoiceField {
  id: string;
  label: string;
  kind?: "choice";
  options: { id: string; label: string }[];
}

export interface RapidNumberField {
  id: string;
  label: string;
  kind: "number";
  unit?: string;
  decimals: number;
}

export type RapidField = RapidChoiceField | RapidNumberField;

export interface RapidExhibit {
  title?: string;
  rows?: { label: string; value: string }[];
  table?: { columns: string[]; rows: string[][] };
}

export interface RapidItem {
  id: string;
  prompt: string;
  exhibit?: RapidExhibit;
  fields: RapidField[];
}

export interface RapidRoundPublicConfig {
  intro: string;
  itemCount: number;
  secondsPerItem: number;
  /** The item open now, with its server deadline (ISO). Absent before and after the round. */
  current?: { index: number; count: number; endsAt: string; item: RapidItem };
  /** Every item has been answered or has timed out. */
  done?: boolean;
}

export const isNumberField = (f: RapidField): f is RapidNumberField => f.kind === "number";

/** What the browser sends for one item. */
export const rapidItemSubmissionSchema = z
  .object({
    index: z.number().int().min(0),
    values: z.record(z.string(), z.union([z.string(), z.number().finite()])),
  })
  .strict();
export type RapidItemSubmission = z.infer<typeof rapidItemSubmissionSchema>;

/** Saved answer: per item id, the values given and the response time in ms (server-measured). */
export const rapidRoundAnswerSchema = z
  .object({
    items: z.record(
      z.string(),
      z
        .object({
          values: z.record(z.string(), z.union([z.string(), z.number().finite()])),
          ms: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type RapidRoundAnswer = z.infer<typeof rapidRoundAnswerSchema>;
