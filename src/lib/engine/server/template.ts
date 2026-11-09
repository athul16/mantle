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
