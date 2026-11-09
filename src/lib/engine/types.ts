/**
 * Engine types shared by server and browser. Nothing in this file may describe
 * or carry an answer key. See docs/06-assessment-engine.md.
 */

/** A value a scenario generator can expose to templates. */
export type VariantValue = string | number;

/**
 * Candidate-specific values produced by a scenario's generator, seeded by the
 * attempt. `values` fill templates the candidate sees; `keys` are the answer
 * keys per step and never leave the server.
 */
export interface Variant {
  values: Record<string, VariantValue>;
  keys: Record<string, unknown>;
}

/** One task inside a scenario. `config` is step-type specific and may contain {{templates}}. */
export interface Step {
  id: string;
  type: string;
  title: string;
  config: unknown;
}

/**
 * An inbox item. `arriveAtMinute` is minutes after the attempt starts
 * (omitted or 0 = present at start). `stepId` links the message to the task it delivers.
 */
export interface Message {
  id: string;
  from: string;
  subject: string;
  body: string;
  arriveAtMinute?: number;
  stepId?: string;
}

/** JSON-serializable scenario content (stored in scenarios.definition). */
export interface ScenarioDefinition {
  intro: string;
  steps: Step[];
  messages: Message[];
}

export interface StepScoreItem {
  id: string;
  label: string;
  earned: number;
  max: number;
  note?: string;
}

export interface StepScore {
  points: number;
  maxPoints: number;
  items: StepScoreItem[];
  /** e.g. rubric scored by AI and awaiting human confirmation */
  needsReview?: boolean;
}

export interface AttemptScore {
  points: number;
  maxPoints: number;
  steps: Record<string, StepScore>;
}

/** What the browser receives for one step: config with variant values filled in, no key. */
export interface PublicStep<PublicConfig = unknown> {
  id: string;
  type: string;
  title: string;
  config: PublicConfig;
}

/** What the browser receives for one inbox message. */
export interface PublicMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  arriveAtMinute: number;
  stepId?: string;
}

/** Props every step-type Component receives in the browser. */
export interface StepComponentProps<PublicConfig, Answer> {
  config: PublicConfig;
  answer?: Answer;
  onChange(answer: Answer): void;
  disabled?: boolean;
}
