import "server-only";

import { documentReviewServer } from "../step-types/document_review/server";
import { inboxReplyServer } from "../step-types/inbox_reply/server";
import { journalEntryServer } from "../step-types/journal_entry/server";
import { multipleChoiceServer } from "../step-types/multiple_choice/server";
import { numericServer } from "../step-types/numeric/server";
import { rapidRoundServer } from "../step-types/rapid_round/server";
import { spreadsheetServer } from "../step-types/spreadsheet/server";
import type { AnyServerStepType } from "./step-type";

/**
 * Server step types, keyed by type id. Adding a new kind of task means adding
 * a plug-in here and in client/registry.ts — never a special case in the
 * attempt flow (CLAUDE.md).
 */
const serverStepTypes: Record<string, AnyServerStepType> = {
  [numericServer.type]: numericServer,
  [inboxReplyServer.type]: inboxReplyServer,
  [spreadsheetServer.type]: spreadsheetServer,
  [journalEntryServer.type]: journalEntryServer,
  [documentReviewServer.type]: documentReviewServer,
  [rapidRoundServer.type]: rapidRoundServer,
  [multipleChoiceServer.type]: multipleChoiceServer,
};

export function getServerStepType(type: string): AnyServerStepType {
  const stepType = serverStepTypes[type];
  if (!stepType) throw new Error(`unknown step type "${type}"`);
  return stepType;
}

export function listServerStepTypes(): string[] {
  return Object.keys(serverStepTypes);
}
