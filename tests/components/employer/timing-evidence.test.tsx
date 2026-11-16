/**
 * The Timing card on the candidate report: rapid answers given right after
 * returning to the window, and a large gap between the rapid round and the
 * other tasks. Evidence only, in neutral words; the card never shows a label.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimingEvidence } from "@/app/app/[orgSlug]/candidates/[inviteId]/timing-evidence";
import type { TimingReport } from "@/lib/results/timing";

const STARTED = "2026-11-10T10:00:00.000Z";
const quick = (index: number, answeredAt: string, afterMs: number, awayMs: number | null) => ({
  stepId: "quick",
  stepTitle: "Rapid checks",
  index,
  answeredAt,
  returnedAt: new Date(Date.parse(answeredAt) - afterMs).toISOString(),
  afterMs,
  awayMs,
});
const none: TimingReport = { quickAfterReturn: [], rapidGap: { rapidPercent: 70, otherPercent: 60, gap: 10, large: false } };

const card = () => screen.getByRole("region", { name: "Timing" });
const row = (name: string) => within(card()).getByRole("group", { name });

describe("TimingEvidence", () => {
  it("renders nothing without a rapid round", () => {
    const { container } = render(<TimingEvidence startedAt={STARTED} timing={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says no answers came right after a return, and hides a small gap", () => {
    render(<TimingEvidence startedAt={STARTED} timing={none} />);
    expect(within(row("Answered within 2 s of returning to the window")).getByText("None")).toBeVisible();
    expect(within(card()).queryByRole("group", { name: "Rapid round vs other tasks" })).not.toBeInTheDocument();
  });

  it("lists each rapid answer given within 2 s of returning, with when and how long the candidate was away", () => {
    const timing: TimingReport = {
      ...none,
      quickAfterReturn: [quick(2, "2026-11-10T10:01:05.000Z", 1_500, 14_000), quick(5, "2026-11-10T10:03:20.000Z", 400, null)],
    };
    render(<TimingEvidence startedAt={STARTED} timing={timing} />);
    const r = row("Answered within 2 s of returning to the window");
    expect(within(r).getByText("2 answers")).toBeVisible();
    const items = within(r).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Rapid checks, item 3: answered 1.5 s after returning (away 14 s) · 1:05 into the test",
      "Rapid checks, item 6: answered 0.4 s after returning · 3:20 into the test",
    ]);
  });

  it("shows a large gap between the rapid round and the other tasks, in either direction", () => {
    const { unmount } = render(
      <TimingEvidence startedAt={STARTED} timing={{ ...none, rapidGap: { rapidPercent: 95, otherPercent: 40, gap: 55, large: true } }} />,
    );
    expect(within(row("Rapid round vs other tasks")).getByText("Rapid round 95% · other tasks 40%")).toBeVisible();
    expect(within(row("Rapid round vs other tasks")).getByText("55 points apart")).toBeVisible();
    unmount();
    render(<TimingEvidence startedAt={STARTED} timing={{ ...none, rapidGap: { rapidPercent: 20, otherPercent: 87.5, gap: -67.5, large: true } }} />);
    expect(within(row("Rapid round vs other tasks")).getByText("Rapid round 20% · other tasks 87.5%")).toBeVisible();
    expect(within(row("Rapid round vs other tasks")).getByText("67.5 points apart")).toBeVisible();
  });

  it("is worded as evidence, says it doesn't change the integrity label, and never shows one", () => {
    render(
      <TimingEvidence
        startedAt={STARTED}
        timing={{ quickAfterReturn: [quick(0, "2026-11-10T10:00:12.000Z", 900, 3_000)], rapidGap: { rapidPercent: 100, otherPercent: 0, gap: 100, large: true } }}
      />,
    );
    expect(within(card()).getByText("For context only. These rows don't change the integrity label or the score.")).toBeVisible();
    expect(card().textContent).not.toMatch(/suspicious|cheat|fraud|review|clear\b/i);
  });

  it("without a gap to compare, shows only the first row", () => {
    render(<TimingEvidence startedAt={STARTED} timing={{ quickAfterReturn: [], rapidGap: null }} />);
    expect(within(card()).getAllByRole("group")).toHaveLength(1);
  });
});
