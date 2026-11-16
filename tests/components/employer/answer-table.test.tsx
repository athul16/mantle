/** The answer-vs-expected table on the candidate report, with rapid items' prompts and response times. */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerTable } from "@/app/app/[orgSlug]/candidates/[inviteId]/answer-table";
import type { StepRow } from "@/lib/results/answer-key";

const rapidRows: StepRow[] = [
  {
    id: "rent",
    label: "Item 1",
    prompt: "Paid rent of $2,500.00 by check.",
    answer: "Debit: Rent expense; Credit: Cash",
    expected: "Debit: Rent expense; Credit: Cash",
    responseMs: 4_200,
    earned: 1,
    max: 1,
  },
  {
    id: "dep",
    label: "Item 2",
    prompt: "Monthly depreciation?",
    answer: "(not answered)",
    expected: "Amount: $125.00",
    earned: 0,
    max: 1,
    note: "No answer (timed out or skipped).",
  },
  { id: "timing", label: "Response time", answer: "Median response 4.2s over 1 answered; 1 with no answer.", expected: "—" },
];

const cells = (name: string) =>
  within(screen.getAllByRole("row").find((r) => r.textContent?.includes(name))!)
    .getAllByRole("cell")
    .map((c) => c.textContent);

describe("AnswerTable", () => {
  it("adds a Time column when rows have response times, and shows each item's prompt", () => {
    render(<AnswerTable rows={rapidRows} first="Jordan" />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Item", "Jordan", "Expected", "Time", "Result"]);
    expect(cells("Item 1")).toEqual([
      "Item 1Paid rent of $2,500.00 by check.",
      "Debit: Rent expense; Credit: Cash",
      "Debit: Rent expense; Credit: Cash",
      "4.2 s",
      "Correct",
    ]);
    expect(cells("Item 2")).toEqual(["Item 2Monthly depreciation?No answer (timed out or skipped).", "—", "Amount: $125.00", "—", "Missing"]);
  });

  it("shows the response-time summary without a result badge", () => {
    render(<AnswerTable rows={rapidRows} first="Jordan" />);
    expect(cells("Response time")).toEqual(["Response time", "Median response 4.2s over 1 answered; 1 with no answer.", "—", "", ""]);
  });

  it("has no Time column for other step types", () => {
    render(<AnswerTable rows={[{ id: "value", label: "Value", answer: "10.00", expected: "12.00", earned: 0, max: 2 }]} first="Jordan" />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Item", "Jordan", "Expected", "Result"]);
    expect(cells("Value")).toEqual(["Value", "10.00", "12.00", "Wrong"]);
  });
});
