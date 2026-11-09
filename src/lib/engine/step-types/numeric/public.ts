/**
 * `numeric` step type, browser-safe part: what the candidate sees and what they
 * submit. No answer key here.
 */
import { z } from "zod";

export const NUMERIC = "numeric";

export interface NumericPublicConfig {
  prompt: string;
  /** Shown next to the input, e.g. "$" or "mg". */
  unit?: string;
  /** Decimal places the candidate should enter. */
  decimals: number;
}

export const numericAnswerSchema = z
  .object({
    value: z.number().finite().nullable(),
  })
  .strict();

export type NumericAnswer = z.infer<typeof numericAnswerSchema>;
