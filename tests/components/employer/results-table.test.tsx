/** Per-job results table: sorting, filtering, search, links to the report. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResultsTable } from "@/app/app/[orgSlug]/candidates/results-table";
import type { ResultRow } from "@/lib/results/summary";

const row = (over: Partial<ResultRow> & Pick<ResultRow, "inviteId" | "email">): ResultRow => ({
  candidateName: null,
  status: "completed",
  needsReview: false,
  points: null,
  maxPoints: null,
  percent: null,
  timeTakenSeconds: null,
  submittedAt: null,
  invitedAt: "2026-11-01T00:00:00Z",
  ...over,
});

const rows: ResultRow[] = [
  row({ inviteId: "i-ann", email: "ann@example.test", candidateName: "Ann Lee", points: 16, maxPoints: 20, percent: 80, timeTakenSeconds: 1200, submittedAt: "2026-11-02T10:00:00Z" }),
  row({ inviteId: "i-bob", email: "bob@example.test", points: 8, maxPoints: 19, percent: 42.1, timeTakenSeconds: 840, submittedAt: "2026-11-03T10:00:00Z", needsReview: true }),
  row({ inviteId: "i-cat", email: "cat@example.test", status: "invited" }),
];

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].querySelector("a")?.textContent);

describe("ResultsTable", () => {
  it("lists candidates best score first, unscored last, with score, time and links", () => {
    render(<ResultsTable rows={rows} reportBase="/app/acme/candidates" />);
    expect(names()).toEqual(["Ann Lee", "bob@example.test", "cat@example.test"]);
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("link", { name: "Ann Lee" })).toHaveAttribute("href", "/app/acme/candidates/i-ann");

    const bob = screen.getByRole("row", { name: /bob@example\.test/ });
    expect(within(bob).getByText("needs review")).toBeVisible();
    expect(within(bob).getByText("42.1%")).toBeVisible();
    expect(within(bob).getByText("8 / 19 so far")).toBeVisible();
    expect(within(bob).getByText("14 min")).toBeVisible();

    const cat = screen.getByRole("row", { name: /cat@example\.test/ });
    expect(within(cat).getByText("invited")).toBeVisible();
    expect(within(cat).getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("Showing 3 of 3")).toBeVisible();
  });

  it("sorts by a column and flips direction on a second click", async () => {
    const user = userEvent.setup();
    render(<ResultsTable rows={rows} reportBase="/x" />);

    await user.click(screen.getByRole("button", { name: /Time taken/ }));
    expect(screen.getByRole("columnheader", { name: /Time taken/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["bob@example.test", "Ann Lee", "cat@example.test"]);

    await user.click(screen.getByRole("button", { name: /Time taken/ }));
    expect(screen.getByRole("columnheader", { name: /Time taken/ })).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Ann Lee", "bob@example.test", "cat@example.test"]);

    await user.click(screen.getByRole("button", { name: /Candidate/ }));
    expect(names()).toEqual(["Ann Lee", "bob@example.test", "cat@example.test"]);
    await user.click(screen.getByRole("button", { name: /Candidate/ }));
    expect(names()).toEqual(["cat@example.test", "bob@example.test", "Ann Lee"]);

    await user.click(screen.getByRole("button", { name: /Submitted/ }));
    expect(names()).toEqual(["bob@example.test", "Ann Lee", "cat@example.test"]);
  });

  it("filters by status and needs review, and searches name or email", async () => {
    const user = userEvent.setup();
    render(<ResultsTable rows={rows} reportBase="/x" />);
    const status = screen.getByRole("combobox", { name: "Status" });

    await user.selectOptions(status, "Needs review");
    expect(names()).toEqual(["bob@example.test"]);
    expect(screen.getByText("Showing 1 of 3")).toBeVisible();

    await user.selectOptions(status, "Invited");
    expect(names()).toEqual(["cat@example.test"]);

    await user.selectOptions(status, "All");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "ann l");
    expect(names()).toEqual(["Ann Lee"]);

    await user.clear(screen.getByRole("searchbox", { name: "Search" }));
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "nobody");
    expect(screen.getByText("No candidates match.")).toBeVisible();
    expect(screen.getByText("Showing 0 of 3")).toBeVisible();
  });
});
