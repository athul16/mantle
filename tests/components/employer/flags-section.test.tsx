/**
 * The Integrity card on the candidate report: recorded signals, each flag
 * with its reason, evidence times and snapshot thumbnails; admins and
 * recruiters confirm or clear with a note; viewers read only. The server
 * action is mocked.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formDataOf } from "../helpers";
import type { ReportFlag } from "@/lib/proctoring/report";

vi.mock("@/app/app/[orgSlug]/candidates/[inviteId]/flag-actions", () => ({ reviewFlag: vi.fn() }));
const { reviewFlag } = await import("@/app/app/[orgSlug]/candidates/[inviteId]/flag-actions");
const { FlagsSection } = await import("@/app/app/[orgSlug]/candidates/[inviteId]/flags-section");

const STARTED = "2026-11-10T10:00:00.000Z";
const open: ReportFlag = {
  id: "f1",
  rule: "screen_share",
  reason: "Screen sharing stopped 1 time",
  status: "open",
  reviewNote: null,
  reviewedAt: null,
  reviewerEmail: null,
  createdAt: "2026-11-10T10:12:31.000Z",
  events: [{ kind: "screen_share_stopped", at: "2026-11-10T10:12:30.000Z" }],
  media: [
    { id: 7, source: "camera", at: "2026-11-10T10:12:25.000Z", url: "https://storage.test/cam.jpg?token=x" },
    { id: 8, source: "screen", at: "2026-11-10T10:12:40.000Z", url: "https://storage.test/scr.jpg?token=y" },
  ],
};
const cleared: ReportFlag = {
  ...open,
  id: "f2",
  rule: "paste",
  reason: "Pasted text 4 times (380 characters)",
  status: "cleared",
  reviewNote: "Pasted from their own earlier answer.",
  reviewedAt: "2026-11-10T12:00:00.000Z",
  reviewerEmail: "rec@example.test",
  events: [],
  media: [],
};

beforeEach(() => vi.clearAllMocks());

function renderSection(props: Partial<Parameters<typeof FlagsSection>[0]> = {}) {
  return render(
    <FlagsSection
      orgId="org"
      startedAt={STARTED}
      flags={[open, cleared]}
      counts={{ left_window: 2, pasted: 4, screen_share_stopped: 1 }}
      canReview
      canSeeMedia
      camera
      screen
      {...props}
    />,
  );
}

describe("FlagsSection", () => {
  it("lists each flag with its status, the time into the test and the reason", () => {
    renderSection();
    const section = screen.getByRole("region", { name: "Integrity" });
    expect(within(section).getByTestId("integrity-badge")).toHaveTextContent("Review · 1 flag");
    const items = within(section).getAllByRole("article");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Screen sharing stopped 1 time");
    expect(items[0]).toHaveTextContent("at 12:30");
    expect(within(items[0]).getByRole("list", { name: "Evidence" })).toHaveTextContent("12:30 into the test");
    expect(items[1]).toHaveTextContent("Cleared");
    expect(items[1]).toHaveTextContent("rec@example.test");
    expect(items[1]).toHaveTextContent("Pasted from their own earlier answer.");
  });

  it("lists each downtime gap with its length, span and how it ended", () => {
    const downtime: ReportFlag = {
      ...open,
      id: "f3",
      rule: "downtime",
      reason: "Camera or screen share was down 2 times: the task was covered for 2 min 5 s in total while the timer kept running",
      events: [
        { kind: "monitoring_down", at: "2026-11-10T10:05:00.000Z", source: "screen", downMs: 45_000, endAt: "2026-11-10T10:05:45.000Z", closedBy: "reconnected" },
        { kind: "monitoring_down", at: "2026-11-10T10:58:40.000Z", source: "camera", downMs: 80_000, endAt: "2026-11-10T11:00:00.000Z", closedBy: "deadline" },
      ],
      media: [],
    };
    renderSection({ flags: [downtime] });
    const items = within(screen.getByRole("list", { name: "Evidence" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Screen share stopped for 45 s (back on) · 5:00 to 5:45 into the test");
    expect(items[1]).toHaveTextContent("Camera off for 1 min 20 s (never back; counted until the time ran out) · 58:40 to 1:00:00 into the test");
    expect(screen.getByText(/the timer kept running\. Judge whether the lost time affected the result/)).toBeVisible();
  });

  it("says flags are for review and never reject anyone", () => {
    renderSection();
    expect(screen.getByText(/Flags are for a person to judge\. Nothing here rejects anyone\./)).toBeVisible();
  });

  it("lists what was recorded during the attempt", () => {
    renderSection();
    const rows = screen.getByRole("region", { name: "Integrity" }).querySelector("dl")!;
    expect(rows).toHaveTextContent("Camera on throughoutYes");
    expect(rows).toHaveTextContent("Entire screen sharedStopped 1×");
    expect(rows).toHaveTextContent("Left the simulation tab2");
    expect(rows).toHaveTextContent("Pastes4");
    expect(rows).toHaveTextContent("Second display connectedNo");
  });

  it("marks camera and screen as not required when the assessment didn't use them", () => {
    renderSection({ camera: false, screen: false });
    const rows = screen.getByRole("region", { name: "Integrity" }).querySelector("dl")!;
    expect(rows).toHaveTextContent("Camera on throughoutNot required");
    expect(rows).toHaveTextContent("Entire screen sharedNot required");
  });

  it("shows evidence thumbnails that open the full snapshot", () => {
    renderSection();
    const thumbs = screen.getAllByRole("img");
    expect(thumbs.map((i) => i.getAttribute("alt"))).toEqual(["Camera snapshot at 12:25", "Screen snapshot at 12:40"]);
    const link = thumbs[0].closest("a")!;
    expect(link).toHaveAttribute("href", "https://storage.test/cam.jpg?token=x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("hides snapshots when the member may not see them", () => {
    renderSection({ canSeeMedia: false, canReview: false });
    expect(screen.queryAllByRole("img")).toEqual([]);
    expect(screen.getByText(/Snapshots are visible to admins and recruiters only\./)).toBeVisible();
  });

  it("lets reviewers confirm or clear an open flag with a note", async () => {
    vi.mocked(reviewFlag).mockResolvedValue({ message: "Flag cleared." });
    const user = userEvent.setup();
    renderSection();
    const form = screen.getByRole("form", { name: "Review flag: Screen sharing stopped 1 time" });
    await user.type(within(form).getByRole("textbox", { name: "Your note (required)" }), "Laptop went to sleep.");
    await user.click(within(form).getByRole("button", { name: "Clear flag" }));
    await waitFor(() => expect(reviewFlag).toHaveBeenCalled());
    expect(formDataOf(vi.mocked(reviewFlag))).toMatchObject({ orgId: "org", flagId: "f1", decision: "cleared", note: "Laptop went to sleep." });
    expect(await within(form).findByText("Flag cleared.")).toBeVisible();
  });

  it("sends confirm as the decision for the confirm button", async () => {
    vi.mocked(reviewFlag).mockResolvedValue({ message: "Flag confirmed." });
    const user = userEvent.setup();
    renderSection();
    const form = screen.getByRole("form", { name: "Review flag: Screen sharing stopped 1 time" });
    await user.type(within(form).getByRole("textbox", { name: "Your note (required)" }), "Other window visible.");
    await user.click(within(form).getByRole("button", { name: "Confirm flag" }));
    await waitFor(() => expect(formDataOf(vi.mocked(reviewFlag))).toMatchObject({ decision: "confirmed" }));
  });

  it("shows the server's note error next to the note", async () => {
    vi.mocked(reviewFlag).mockResolvedValue({ fieldErrors: { note: ["Add a short note explaining the decision."] } });
    const user = userEvent.setup();
    renderSection();
    const form = screen.getByRole("form", { name: "Review flag: Screen sharing stopped 1 time" });
    await user.type(within(form).getByRole("textbox", { name: "Your note (required)" }), " ");
    await user.click(within(form).getByRole("button", { name: "Confirm flag" }));
    expect(await within(form).findByText("Add a short note explaining the decision.")).toBeVisible();
    expect(within(form).getByRole("textbox", { name: "Your note (required)" })).toHaveAttribute("aria-invalid", "true");
  });

  it("lets reviewers change a decision already made", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByText("Change decision"));
    expect(screen.getByRole("form", { name: "Review flag: Pasted text 4 times (380 characters)" })).toBeVisible();
  });

  it("is read-only for viewers", () => {
    renderSection({ canReview: false });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear flag" })).not.toBeInTheDocument();
  });

  it("says when there are no flags, and when the test was not monitored", () => {
    const { unmount } = renderSection({ flags: [] });
    const section = screen.getByRole("region", { name: "Integrity" });
    expect(section).toHaveTextContent("No integrity flags.");
    expect(within(section).getByTestId("integrity-badge")).toHaveTextContent("Clear");
    unmount();
    renderSection({ flags: [], camera: false, screen: false });
    expect(screen.getByText(/Camera and screen monitoring were off for this assessment; only browser activity was checked\./)).toBeVisible();
  });
});
