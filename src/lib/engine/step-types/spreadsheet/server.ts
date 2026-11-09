import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import {
  CELL_ID_PATTERN,
  SPREADSHEET,
  spreadsheetAnswerSchema,
  type PublicCell,
  type SpreadsheetAnswer,
  type SpreadsheetCellFormat,
  type SpreadsheetPublicConfig,
} from "./public";

/**
 * Authored cells. A plain string is a read-only text cell; strings may contain
 * {{templates}} (e.g. "{{bank|money}}"). `null` is an empty cell.
 */
const textCellSchema = z
  .object({
    text: z.string(),
    bold: z.boolean().optional(),
    align: z.enum(["left", "right"]).optional(),
  })
  .strict();

const inputCellSchema = z
  .object({
    input: z.string().regex(CELL_ID_PATTERN),
    /** Name in the company report, e.g. "Adjusted bank balance". Defaults to the id. */
    label: z.string().min(1).optional(),
    /** Points if this cell is in the key and correct. */
    points: z.number().positive().default(1),
    format: z.enum(["money", "number"]).default("money"),
  })
  .strict();

const cellSchema = z.union([z.string(), textCellSchema, inputCellSchema, z.null()]);

/** Authored config: a header row and a grid of cells. Every row has one cell per column. */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    columns: z.array(z.string()).min(1).max(26),
    rows: z.array(z.array(cellSchema)).min(1).max(200),
  })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.rows.forEach((row, r) => {
      if (row.length !== c.columns.length) {
        ctx.addIssue({ code: "custom", message: `row ${r} has ${row.length} cells, expected ${c.columns.length}` });
      }
      for (const cell of row) {
        if (cell && typeof cell === "object" && "input" in cell) {
          if (seen.has(cell.input)) ctx.addIssue({ code: "custom", message: `duplicate input cell "${cell.input}"` });
          seen.add(cell.input);
        }
      }
    });
  });
export type SpreadsheetConfig = z.infer<typeof configSchema>;
type InputCell = z.infer<typeof inputCellSchema>;

/**
 * Expected values for the scored input cells, from the scenario generator.
 * Full credit for a cell within its tolerance (or the default `tolerance`),
 * else 0. Input cells not in the key are scratch cells and aren't scored.
 */
const keySchema = z
  .object({
    tolerance: z.number().min(0).default(0),
    cells: z
      .record(
        z.string().regex(CELL_ID_PATTERN),
        z.object({ value: z.number().finite(), tolerance: z.number().min(0).optional() }).strict(),
      )
      .refine((cells) => Object.keys(cells).length > 0, { message: "key needs at least one cell" }),
  })
  .strict();
export type SpreadsheetKey = z.infer<typeof keySchema>;

const isInput = (cell: unknown): cell is InputCell => !!cell && typeof cell === "object" && "input" in cell;

/** Input cells in reading order (row by row, left to right). */
export function inputCells(config: SpreadsheetConfig): InputCell[] {
  return config.rows.flat().filter(isInput);
}

function formatCell(value: number, format: SpreadsheetCellFormat): string {
  return format === "money"
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export const spreadsheetServer: ServerStepType<SpreadsheetConfig, SpreadsheetPublicConfig, SpreadsheetAnswer, SpreadsheetKey> = {
  type: SPREADSHEET,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    return {
      prompt: fill(config.prompt),
      columns: config.columns.map(fill),
      rows: config.rows.map((row) =>
        row.map((cell): PublicCell => {
          if (cell === null) return { kind: "empty" };
          if (typeof cell === "string") return { kind: "text", text: fill(cell) };
          if (isInput(cell)) return { kind: "input", id: cell.input, format: cell.format };
          return { kind: "text", text: fill(cell.text), bold: cell.bold, align: cell.align };
        }),
      ),
    };
  },

  parseAnswer(raw) {
    return spreadsheetAnswerSchema.parse(raw);
  },

  /** One item per keyed cell, in grid order. The note gives the expected value for the company report. */
  score({ config, key, answer }) {
    const inputs = new Map(inputCells(config).map((c) => [c.input, c]));
    for (const id of Object.keys(key.cells)) {
      if (!inputs.has(id)) throw new Error(`spreadsheet key references unknown input cell "${id}"`);
    }
    // Tiny epsilon so float noise in a sum never costs a candidate a point.
    const eps = 1e-9;

    const items = [...inputs.values()]
      .filter((cell) => cell.input in key.cells)
      .map((cell) => {
        const expected = key.cells[cell.input];
        const tolerance = expected.tolerance ?? key.tolerance;
        const given = answer?.cells[cell.input] ?? null;
        const want = formatCell(expected.value, cell.format);
        const base = { id: cell.input, label: cell.label ?? cell.input, max: cell.points };

        if (given === null) return { ...base, earned: 0, note: `Not answered. Expected ${want}.` };
        if (Math.abs(given - expected.value) <= tolerance + eps) {
          return { ...base, earned: cell.points, note: `Correct (${formatCell(given, cell.format)}).` };
        }
        return { ...base, earned: 0, note: `Answered ${formatCell(given, cell.format)}, expected ${want}.` };
      });

    return {
      points: items.reduce((sum, i) => sum + i.earned, 0),
      maxPoints: items.reduce((sum, i) => sum + i.max, 0),
      items,
    };
  },
};
