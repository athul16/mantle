import "server-only";

import type { VariantValue } from "../types";

/**
 * Fills {{name}} and {{name|format}} placeholders with variant values.
 * Formats: `money` (cents -> $1,234.56), `number`. Unknown names throw, so a
 * typo in a scenario fails loudly instead of showing "{{oops}}" to a candidate.
 */
export function fillTemplate(template: string, values: Record<string, VariantValue>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([a-z]+)\s*)?\}\}/g, (_, name: string, format?: string) => {
    if (!(name in values)) throw new Error(`template references unknown variant value "${name}"`);
    return formatValue(values[name], format);
  });
}

/** Who the material is rendered for. Not seeded: the same seed renders the same numbers for anyone. */
export interface CandidateContext {
  /** The name the candidate gave when verifying (invites.candidate_name). */
  name?: string | null;
}

/** Template names filled from the candidate, not the variant. A generator can't use them. */
export const CANDIDATE_TEMPLATE_NAMES = ["first_name"] as const;

/** Used in place of a first name when the candidate gave none, so "Hi {{first_name}}," reads "Hi there,". */
export const FIRST_NAME_FALLBACK = "there";

const MAX_FIRST_NAME = 40;

/** First word of the candidate's name, or the fallback. */
export function candidateFirstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, MAX_FIRST_NAME) : FIRST_NAME_FALLBACK;
}

/**
 * Variant values plus the candidate's own (`{{first_name}}`), for filling
 * material the candidate sees. Throws if a generator emits a reserved name,
 * so a variant value can never silently shadow the candidate's.
 */
export function templateValues(
  values: Record<string, VariantValue>,
  candidate: CandidateContext = {},
): Record<string, VariantValue> {
  for (const name of CANDIDATE_TEMPLATE_NAMES) {
    if (name in values) throw new Error(`variant value "${name}" is reserved for the candidate`);
  }
  return { ...values, first_name: candidateFirstName(candidate.name) };
}

export function formatValue(value: VariantValue, format?: string): string {
  switch (format) {
    case undefined:
      return String(value);
    case "money":
      return formatCents(Number(value));
    case "number":
      return Number(value).toLocaleString("en-US");
    default:
      throw new Error(`unknown template format "${format}"`);
  }
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
