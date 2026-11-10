import { createElement, type ComponentType, type ReactElement } from "react";
import { DocumentReviewStep } from "../step-types/document_review/client";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { InboxReplyStep } from "../step-types/inbox_reply/client";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { JournalEntryStep } from "../step-types/journal_entry/client";
import { JOURNAL_ENTRY } from "../step-types/journal_entry/public";
import { NumericStep } from "../step-types/numeric/client";
import { NUMERIC } from "../step-types/numeric/public";
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
};

export function hasStepComponent(type: string): boolean {
  return type in clientStepTypes;
}

/** Element for a step of `type`, or null if no client plug-in is registered. */
export function renderStepElement(type: string, props: StepComponentProps<unknown, unknown>): ReactElement | null {
  const component = clientStepTypes[type];
  return component ? createElement(component, props) : null;
}
