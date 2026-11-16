import { createElement, type ComponentType, type ReactElement } from "react";
import { DocumentReviewStep } from "../step-types/document_review/client";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { InboxReplyStep } from "../step-types/inbox_reply/client";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { JournalEntryStep } from "../step-types/journal_entry/client";
import { JOURNAL_ENTRY } from "../step-types/journal_entry/public";
import { MultipleChoiceStep } from "../step-types/multiple_choice/client";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { NumericStep } from "../step-types/numeric/client";
import { NUMERIC } from "../step-types/numeric/public";
import { OrderingStep } from "../step-types/ordering/client";
import { ORDERING } from "../step-types/ordering/public";
import { RapidRoundStep } from "../step-types/rapid_round/client";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SpreadsheetStep } from "../step-types/spreadsheet/client";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import type { StepComponentProps } from "../types";

/**
 * Browser step types, keyed by type id. Each entry only knows how to render a
 * public config and emit an answer; scoring and keys live in server/registry.ts.
 */
// Entries are heterogeneous; the type id decides which config shape applies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStepComponent = ComponentType<StepComponentProps<any, any>>;

export const clientStepTypes: Record<string, AnyStepComponent> = {
  [NUMERIC]: NumericStep,
  [INBOX_REPLY]: InboxReplyStep,
  [SPREADSHEET]: SpreadsheetStep,
  [JOURNAL_ENTRY]: JournalEntryStep,
  [DOCUMENT_REVIEW]: DocumentReviewStep,
  [RAPID_ROUND]: RapidRoundStep,
  [MULTIPLE_CHOICE]: MultipleChoiceStep,
  [ORDERING]: OrderingStep,
};

export function hasStepComponent(type: string): boolean {
  return type in clientStepTypes;
}

/** Element for a step of `type`, or null if no client plug-in is registered. */
export function renderStepElement(type: string, props: StepComponentProps<unknown, unknown>): ReactElement | null {
  const component = clientStepTypes[type];
  return component ? createElement(component, props) : null;
}

/**
 * The instructions the page should show next to a step (the workspace's brief
 * column), or null when the step's own view shows them. A numeric or
 * multiple_choice step's prompt is the question itself, so it stays on the
 * step's card.
 */
export function stepBrief(step: { type: string; config: unknown }): string | null {
  if (step.type === NUMERIC || step.type === MULTIPLE_CHOICE) return null;
  const prompt = (step.config as { prompt?: unknown } | null)?.prompt;
  return typeof prompt === "string" && prompt.trim() !== "" ? prompt : null;
}
