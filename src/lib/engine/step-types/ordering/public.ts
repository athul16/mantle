/**
 * `ordering` step type, browser-safe part: a prompt and 6 to 12 items the
 * candidate puts in order. The right order lives in the server key; items are
 * shown in the authored order, which says nothing about the answer.
 */
import { z } from "zod";

export const ORDERING = "ordering";

/** Item ids. Shared by config, key and answer. */
export const ITEM_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const MIN_ITEMS = 6;
export const MAX_ITEMS = 12;

export interface OrderingItem {
  id: string;
  label: string;
  /** Optional second line, e.g. a provider or a short description. */
  detail?: string;
}

export interface OrderingPublicConfig {
  prompt: string;
  items: OrderingItem[];
}

const unique = (ids: string[]) => new Set(ids).size === ids.length;

/** Saved answer: item ids, first to last. */
export const orderingAnswerSchema = z
  .object({
    order: z.array(z.string().regex(ITEM_ID_PATTERN)).max(MAX_ITEMS).refine(unique, { message: "each item once" }),
  })
  .strict();

export type OrderingAnswer = z.infer<typeof orderingAnswerSchema>;

/** The answer schema for one step: every one of `itemIds` exactly once, nothing else. */
export function orderingAnswerSchemaFor(itemIds: string[]) {
  const known = new Set(itemIds);
  return orderingAnswerSchema.refine((a) => a.order.length === known.size && a.order.every((id) => known.has(id)), {
    message: "the order must list every item exactly once",
  });
}
