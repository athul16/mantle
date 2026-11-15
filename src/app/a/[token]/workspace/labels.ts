/**
 * Presentation helpers for the workspace, review and done pages. Plain
 * functions (no "use client") so server pages can use them too. Nothing here
 * knows about answer keys or scoring.
 */

/** "Harbor Lane October workbook: journal entries" → "Journal entries" (the part after the last colon). */
export function shortLabel(title: string): string {
  const tail = title.includes(": ") ? title.slice(title.lastIndexOf(": ") + 2) : title;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** What kind of work a step is, in the candidate's words. */
export function stepKindLabel(type: string): string {
  return (
    {
      spreadsheet: "Spreadsheet",
      journal_entry: "Journal entries",
      inbox_reply: "Email reply",
      numeric: "Numeric answer",
      document_review: "Document review",
    }[type] ?? "Task"
  );
}

/** Steps shown as sheets of one workbook (tabs above the grid). */
export function isWorkbookStep(type: string): boolean {
  return type === "spreadsheet" || type === "journal_entry";
}

/** "Dana Ruiz, Senior Associate, Oakline CPA Group" → { name: "Dana Ruiz", role: "Senior Associate, Oakline CPA Group" }. */
export function senderParts(from: string): { name: string; role: string } {
  const i = from.indexOf(",");
  return i < 0 ? { name: from.trim(), role: "" } : { name: from.slice(0, i).trim(), role: from.slice(i + 1).trim() };
}

/** "1:05:00", "44:59", "0:07" — the countdown text. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Whether a saved answer has anything in it. Same rule the server's review
 * list uses (src/lib/candidate/attempt.ts), plus empty containers count as
 * not started so a cleared step isn't shown as answered in the browser.
 */
export function hasAnswer(answer: unknown): boolean {
  if (answer === undefined || answer === null) return false;
  if (typeof answer !== "object") return true;
  const a = answer as Record<string, unknown>;
  if ("value" in a) return a.value !== null && a.value !== undefined;
  if ("body" in a) return typeof a.body === "string" && a.body.trim() !== "";
  if ("cells" in a) return Object.values((a.cells as Record<string, unknown>) ?? {}).some((v) => v !== null && v !== undefined);
  if ("entries" in a)
    return ((a.entries as { lines?: { account?: string; debit?: unknown; credit?: unknown }[] }[]) ?? []).some((e) =>
      (e.lines ?? []).some((l) => l.account || l.debit != null || l.credit != null),
    );
  if ("flags" in a) return ((a.flags as unknown[]) ?? []).length > 0 || (a.decision ?? null) !== null;
  return true;
}
