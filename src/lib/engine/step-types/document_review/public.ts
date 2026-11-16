/**
 * `document_review` step type, browser-safe part: a document (invoice, bank
 * statement, ledger extract) whose header fields, lines and totals the
 * candidate can flag, each with a reason. Which items are real issues lives in
 * the server key.
 */
import { z } from "zod";

export const DOCUMENT_REVIEW = "document_review";

/** Ids of flaggable items, reasons and decisions. Shared by config, key and answer. */
export const REVIEW_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
/** Upper bounds so autosave can't be used to stuff the database. */
export const MAX_FLAGS = 50;
export const MAX_FLAG_NOTE_CHARS = 500;

/** A labelled value in the document header or totals block, e.g. "Invoice #" / "INV-2231". */
export interface DocumentField {
  id: string;
  label: string;
  value: string;
}

export interface DocumentRow {
  id: string;
  cells: string[];
}

export interface ReviewOption {
  id: string;
  label: string;
}

export interface DocumentReviewPublicConfig {
  prompt: string;
  document: {
    title: string;
    fields: DocumentField[];
    columns: string[];
    rows: DocumentRow[];
    totals: DocumentField[];
    footnote?: string;
  };
  reasons: ReviewOption[];
  /** Optional final call on the whole document, e.g. approve / reject / ask vendor. */
  decision?: { prompt: string; options: ReviewOption[] };
  /** Optional "nothing wrong here" confirm for the whole document. Whether it's right is in the key. */
  confirmClean?: { label: string };
  maxFlags: number;
}

export const documentReviewAnswerSchema = z
  .object({
    flags: z
      .array(
        z
          .object({
            target: z.string().regex(REVIEW_ID_PATTERN),
            /** "" while the candidate hasn't picked a reason yet. */
            reason: z.union([z.literal(""), z.string().regex(REVIEW_ID_PATTERN)]),
            note: z.string().max(MAX_FLAG_NOTE_CHARS).default(""),
          })
          .strict(),
      )
      .max(MAX_FLAGS)
      .refine((flags) => new Set(flags.map((f) => f.target)).size === flags.length, {
        message: "one flag per item",
      }),
    decision: z.string().regex(REVIEW_ID_PATTERN).nullable().default(null),
    /** The candidate confirmed the document has nothing wrong. Absent in answers saved before the option existed. */
    clean: z.boolean().optional(),
  })
  .strict();

export type DocumentReviewAnswer = z.infer<typeof documentReviewAnswerSchema>;
export type DocumentFlag = DocumentReviewAnswer["flags"][number];
