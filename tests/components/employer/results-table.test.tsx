/** Job candidates table: sorting, filters, search, selection, export, the invite drawer and links to the report. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CandidateRow } from "@/lib/results/candidate-table";

// The row actions are the job page's invite forms; their server actions aren't under test here.
vi.mock("@/app/app/[orgSlug]/jobs/actions", () => ({
  inviteCandidates: vi.fn(),
  resendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));

const { ResultsTable } = await import("@/app/app/[orgSlug]/candidates/results-table");

const row = (over: Partial<CandidateRow> & Pick<CandidateRow, "inviteId" | "email">): CandidateRow => ({
  candidateName: null,
  status: "completed",
  needsReview: false,
  points: null,
  maxPoints: null,
  percent: null,
  timeTakenSeconds: null,
  submittedAt: null,
  invitedAt: "2026-11-01T00:00:00Z",
  startedAt: null,
  expiresAt: "2026-11-30T00:00:00Z",
  integrity: null,
  flagCount: 0,
  hireVotes: 0,
  noHireVotes: 0,
  tasks: [],
  replyToScore: false,
  percentile: null,
  ...over,
});

const rows: CandidateRow[] = [
  row({
    inviteId: "i-ann",
    email: "ann@example.test",
    candidateName: "Ann Lee",
    points: 16,
    maxPoints: 20,
    percent: 80,
    percentile: 99,
    timeTakenSeconds: 1200,
    submittedAt: "2026-11-02T10:00:00Z",
    integrity: "clear",
    hireVotes: 2,
    tasks: [
      { stepId: "rec", title: "Reconciliation", points: 8, maxPoints: 8 },
      { stepId: "reply", title: "Reply", points: 8, maxPoints: 12 },
    ],
  }),
  row({
    inviteId: "i-bob",
    email: "bob@example.test",
    points: 8,
    maxPoints: 19,
    percent: 42.1,
    percentile: 1,
    timeTakenSeconds: 840,
    submittedAt: "2026-11-03T10:00:00Z",
    needsReview: true,
    replyToScore: true,
    integrity: "suspicious",
    flagCount: 3,
  }),
  row({ inviteId: "i-cat", email: "cat@example.test", status: "invited" }),
];

const ctx = { orgId: "org-1", canManage: true, deadlinePassed: false, passScore: 60, jobTitle: "Audit intern" };

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[1].querySelector("a, button")?.textContent);

describe("ResultsTable", () => {
  it("lists candidates best score first, unscored last, with score, percentile, tasks, integrity and votes", () => {
    render(<ResultsTable rows={rows} reportBase="/app/acme/candidates" ctx={ctx} />);
    expect(names()).toEqual(["Ann Lee", "bob@example.test", "cat@example.test"]);
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("link", { name: "Ann Lee" })).toHaveAttribute("href", "/app/acme/candidates/i-ann");

    const ann = screen.getByRole("row", { name: /Ann Lee/ });
    expect(within(ann).getByText("80")).toBeVisible();
    expect(within(ann).getByText("99th")).toBeVisible();
    expect(within(ann).getByRole("img", { name: "Reply: 8 of 12" })).toBeVisible();
    expect(within(ann).getByText("Clear")).toBeVisible();
    expect(within(ann).getByTitle("2 hire votes")).toHaveTextContent("2");

    const bob = screen.getByRole("row", { name: /bob@example\.test/ });
    expect(within(bob).getByText("Reply to score")).toBeVisible();
    expect(within(bob).getByText("42.1")).toBeVisible();
    expect(within(bob).getByTitle("8 / 19 points so far")).toBeVisible();
    expect(within(bob).getByText(/· 14 min$/)).toBeVisible();
    expect(within(bob).getByText("Suspicious · 3")).toBeVisible();

    const cat = screen.getByRole("row", { name: /cat@example\.test/ });
    expect(within(cat).getByText("Invited", { selector: ".badge" })).toBeVisible();
    expect(within(cat).getAllByText("—")).toHaveLength(5);
    expect(screen.getByText("Showing 3 of 3")).toBeVisible();
  });

  it("sorts by a column and flips direction on a second click", async () => {
    const user = userEvent.setup();
    render(<ResultsTable rows={rows} reportBase="/x" ctx={ctx} />);

    await user.click(screen.getByRole("button", { name: "Score" }));
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "ascending");
    expect(names()).toEqual(["bob@example.test", "Ann Lee", "cat@example.test"]);

    await user.click(screen.getByRole("button", { name: "Candidate" }));
    expect(screen.getByRole("columnheader", { name: /Candidate/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["Ann Lee", "bob@example.test", "cat@example.test"]);
    await user.click(screen.getByRole("button", { name: "Candidate" }));
    expect(names()).toEqual(["cat@example.test", "bob@example.test", "Ann Lee"]);
  });

  it("filters by status, score and integrity, and searches name or email", async () => {
    const user = userEvent.setup();
    render(<ResultsTable rows={rows} reportBase="/x" ctx={ctx} />);
    const status = screen.getByRole("combobox", { name: "Status" });

    await user.selectOptions(status, "Status: Needs review");
    expect(names()).toEqual(["bob@example.test"]);
    expect(screen.getByText("Showing 1 of 3 (filtered)")).toBeVisible();
    await user.selectOptions(status, "Status: Invited");
    expect(names()).toEqual(["cat@example.test"]);
    await user.selectOptions(status, "Status: Any");

    await user.selectOptions(screen.getByRole("combobox", { name: "Score" }), "Score: 60+ (pass mark)");
    expect(names()).toEqual(["Ann Lee"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Score" }), "Score: Any");

    await user.selectOptions(screen.getByRole("combobox", { name: "Integrity" }), "Integrity: Suspicious");
    expect(names()).toEqual(["bob@example.test"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Integrity" }), "Integrity: Any");

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "ann l");
    expect(names()).toEqual(["Ann Lee"]);
    await user.clear(screen.getByRole("searchbox", { name: "Search" }));
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "nobody");
    expect(screen.getByText("No candidates match.")).toBeVisible();
    expect(screen.getByText("Showing 0 of 3 (filtered)")).toBeVisible();
  });

  it("selects rows for export and opens the export dialog with the selection", async () => {
    const user = userEvent.setup();
    render(<ResultsTable rows={rows} reportBase="/x" ctx={ctx} />);
    await user.click(screen.getByRole("checkbox", { name: "Select Ann Lee" }));
    expect(screen.getByText("1 selected")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeVisible();

    await user.click(screen.getAllByRole("button", { name: "Export" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Export results" });
    expect(within(dialog).getByRole("radio", { name: "3 selected" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Everyone in this job/ })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Export results" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it("opens the invite drawer for a candidate who hasn't started, with resend and revoke", async () => {
    const user = userEvent.setup();
    render(<ResultsTable rows={rows} reportBase="/x" ctx={ctx} />);
    await user.click(screen.getByRole("button", { name: "cat@example.test" }));
    const drawer = screen.getByRole("dialog", { name: "cat@example.test" });
    expect(within(drawer).getByRole("button", { name: /Resend/ })).toBeVisible();
    expect(within(drawer).getByRole("button", { name: "Revoke" })).toBeVisible();
    await user.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows no actions to viewers", () => {
    render(<ResultsTable rows={rows} reportBase="/x" ctx={{ ...ctx, canManage: false }} />);
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resend|Revoke/ })).toBeNull();
  });
});
