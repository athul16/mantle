/**
 * `multiple_choice` step type, browser-safe part: a prompt and a list of
 * options, pick one ("single") or all that apply ("multi"). Which options are
 * right lives in the server key.
 */
import { z } from "zod";

export const MULTIPLE_CHOICE = "multiple_choice";

/** Option ids. Shared by config, key and answer. */
export const OPTION_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const MAX_OPTIONS = 20;

export interface MultipleChoiceOption {
  id: string;
  label: string;
}

export interface MultipleChoicePublicConfig {
  prompt: string;
  options: MultipleChoiceOption[];
  select: "single" | "multi";
}

export const multipleChoiceAnswerSchema = z
  .object({
    selected: z
      .array(z.string().regex(OPTION_ID_PATTERN))
      .max(MAX_OPTIONS)
      .refine((ids) => new Set(ids).size === ids.length, { message: "each option once" }),
  })
  .strict();

export type MultipleChoiceAnswer = z.infer<typeof multipleChoiceAnswerSchema>;
