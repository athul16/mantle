/**
 * `spreadsheet` step type, browser-safe part: a grid of read-only cells (text
 * and numbers filled from the variant) and editable input cells. No expected
 * values here; those live in the server key.
 */
import { z } from "zod";

export const SPREADSHEET = "spreadsheet";

/** Input cell ids: short, URL- and JSON-safe. Shared by config, key and answer. */
export const CELL_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
/** Upper bound on cells in one answer, so autosave can't be used to stuff the database. */
export const MAX_ANSWER_CELLS = 500;

export type SpreadsheetCellFormat = "money" | "number";

export type PublicCell =
  | { kind: "text"; text: string; bold?: boolean; align?: "left" | "right" }
  | { kind: "input"; id: string; format: SpreadsheetCellFormat }
  | { kind: "empty" };

export interface SpreadsheetPublicConfig {
  prompt: string;
  columns: string[];
  rows: PublicCell[][];
}

/** One number (or null for a cleared cell) per input cell id. Text inputs aren't supported yet. */
export const spreadsheetAnswerSchema = z
  .object({
    cells: z
      .record(z.string().regex(CELL_ID_PATTERN), z.number().finite().nullable())
      .refine((cells) => Object.keys(cells).length <= MAX_ANSWER_CELLS, { message: "too many cells" }),
  })
  .strict();

export type SpreadsheetAnswer = z.infer<typeof spreadsheetAnswerSchema>;

/**
 * Parses what a candidate typed into a number: allows "$", thousands commas,
 * spaces and accounting negatives "(1,200.00)". Returns null for blank or junk.
 * Shared so the browser and tests agree on what a cell means.
 */
export function parseCellInput(text: string): number | null {
  let s = text.replace(/[\s,$]/g, "");
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
