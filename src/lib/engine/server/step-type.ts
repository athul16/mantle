import "server-only";

import type { z } from "zod";
import type { StepScore, Variant } from "../types";

/** Helpers a step type gets when building the candidate-facing config. */
export interface PublicContext {
  variant: Variant;
  /** Fills {{name}} / {{name|money}} placeholders with this candidate's values. */
  fill(template: string): string;
}

/**
 * Server half of a step type (docs/06). Pairs with a ClientStepType of the same
 * `type` that renders `PublicConfig`. Everything here may touch answer keys, so
 * it must never be imported by browser code.
 */
export interface ServerStepType<Config, PublicConfig, Answer, Key> {
  type: string;
  /** Validates the step's authored config inside a scenario definition. */
  configSchema: z.ZodType<Config>;
  /** Validates the answer key a scenario generator produced for this step. */
  keySchema: z.ZodType<Key>;
  /** Builds what the browser sees. Must not include anything from the key. */
  toPublic(config: Config, ctx: PublicContext): PublicConfig;
  /** Validates the saved answer JSON shape; throws on bad input. */
  parseAnswer(raw: unknown): Answer;
  /** Scores an answer against the key computed from the variant. */
  score(args: { config: Config; key: Key; variant: Variant; answer: Answer | undefined }): StepScore;
  /**
   * Optional: the step is a timed sequence of items shown one at a time (e.g.
   * rapid_round). The attempt flow then sends only the current item, filled
   * and without its key, and records answers one item at a time with their
   * response time. Item timing comes from server events, not from here.
   */
  sequence?: StepSequence<Config, Answer>;
}

export interface StepSequence<Config, Answer> {
  count(config: Config): number;
  secondsPerItem(config: Config): number;
  /** One item for the browser, templates filled. Must not include anything from the key. */
  renderItem(config: Config, ctx: PublicContext, index: number): unknown;
  /**
   * Adds the answer to item `index` (raw `{ index, values }` from the browser)
   * to the saved answer. Throws on a bad shape, an item other than `index`, or
   * an item that already has an answer.
   */
  recordItem(config: Config, prev: Answer | undefined, index: number, raw: unknown, ms: number): Answer;
}

// Registry entries are heterogeneous; callers go through the helpers in render.ts / score.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyServerStepType = ServerStepType<any, any, any, any>;
