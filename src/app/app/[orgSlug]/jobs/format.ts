/** Display helpers shared by the jobs and assessments pages. */

/** "Harbor Lane Coffee: October bank reconciliation (v1)" → without the version suffix. */
export function simulationName(scenarioTitle: string) {
  return scenarioTitle.replace(/\s*\(v\d+\)$/, "");
}

/** Step type → what the candidate does, as the library lists it. */
export const STEP_LABELS: Record<string, string> = {
  inbox_reply: "Inbox reply",
  spreadsheet: "Spreadsheet",
  journal_entry: "Journal entry",
  document_review: "Document review",
  numeric: "Numeric answer",
  rapid_round: "Rapid round",
  multiple_choice: "Multiple choice",
};

/** "accounting" → "Accounting". */
export function roleFamilyLabel(family: string) {
  return family.charAt(0).toUpperCase() + family.slice(1);
}
