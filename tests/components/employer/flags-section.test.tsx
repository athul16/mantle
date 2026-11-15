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

describe("FlagsSection: proctoring v2", () => {
  const away = (n: number) => new Date(Date.parse("2026-11-10T10:20:00.000Z") + n * 1000).toISOString();
  const media = (id: number, n: number, source: "camera" | "screen" | "audio", reason?: "left_window" | "away" | "returned" | "speech") => ({
    id,
    source,
    at: away(n),
    url: `https://storage.test/${id}.${source === "audio" ? "webm" : "jpg"}`,
    reason: reason ?? null,
  });
  const leave: ReportFlag = {
    ...open,
    id: "fl",
    rule: "left_window",
    reason: "Left the test window 1 time",
    events: [
      {
        kind: "left_window",
        at: away(0),
        awayMs: 8000,
        mediaIds: [1, 2, 3, 4],
        media: [media(1, 2, "screen"), media(2, 6, "screen"), media(3, 3, "camera"), media(4, 8, "screen", "returned")],
      },
    ],
    media: [],
  };

  it("shows the label with its reasons and the one-line explanation", () => {
    const copyLeave: ReportFlag = { ...open, id: "c", rule: "copy_then_leave", reason: "x", events: [], media: [] };
    renderSection({ flags: [copyLeave] });
    const card = screen.getByRole("region", { name: "Integrity" });
    expect(within(card).getByTestId("integrity-label")).toHaveTextContent("Suspicious");
    expect(card).toHaveTextContent("Copied text, then left the test window");
    expect(card).toHaveTextContent("Suspicious = a combination of signals that together suggest outside help; Review = something unusual a person should look at.");
  });

  it("labels a single minor flag as review and a clean attempt as clear", () => {
    const { unmount } = renderSection({ flags: [{ ...open, rule: "paste", events: [], media: [] }] });
    expect(screen.getByTestId("integrity-label")).toHaveTextContent("Review");
    expect(screen.getByText(/Flagged for review: pasted text/)).toBeVisible();
    unmount();
    renderSection({ flags: [] });
    expect(screen.getByTestId("integrity-label")).toHaveTextContent("Clear");
  });

  it("counts copies and, when on, looks away, no face, extra faces, speech and full screen exits", () => {
    renderSection({
      counts: { copied: 2, cut: 1, looking_away: 3, no_face: 1, multiple_faces: 2, speech_started: 4, fullscreen_exited: 5 },
      gaze: true,
      microphone: true,
      fullscreen: true,
    });
    const rows = screen.getByRole("region", { name: "Integrity" }).querySelector("dl")!;
    expect(rows).toHaveTextContent("Copies3");
    expect(rows).toHaveTextContent("Looked away3");
    expect(rows).toHaveTextContent("No face1");
    expect(rows).toHaveTextContent("More than one face2");
    expect(rows).toHaveTextContent("Speech heard4");
    expect(rows).toHaveTextContent("Full screen exits5");
    expect(rows).toHaveTextContent("Pastes4");
  });

  it("hides the optional counters when the setting is off", () => {
    renderSection({ counts: { looking_away: 3, speech_started: 1 } });
    const rows = screen.getByRole("region", { name: "Integrity" }).querySelector("dl")!;
    expect(rows).not.toHaveTextContent("Looked away");
    expect(rows).not.toHaveTextContent("Speech heard");
    expect(rows).toHaveTextContent("Copies0");
  });

  it("words the new events", () => {
    const f: ReportFlag = {
      ...open,
      rule: "gaze",
      events: [
        { kind: "looking_away", at: away(0), direction: "left", awayMs: 12_000 },
        { kind: "no_face", at: away(20), awayMs: 5000 },
        { kind: "multiple_faces", at: away(30), faces: 2 },
        { kind: "speech_started", at: away(40), speechMs: 8000 },
        { kind: "copied", at: away(50), chars: 12 },
        { kind: "cut", at: away(60), chars: 3 },
      ],
      media: [],
    };
    renderSection({ flags: [f] });
    const items = within(screen.getByRole("list", { name: "Evidence" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Looked away (left) for 12 s");
    expect(items[1]).toHaveTextContent("No face in view for 5 s");
    expect(items[2]).toHaveTextContent("2 faces in view");
    expect(items[3]).toHaveTextContent("Speech heard for 8 s");
    expect(items[4]).toHaveTextContent("Copied text, 12 characters");
    expect(items[5]).toHaveTextContent("Cut text, 3 characters");
  });

  it("reads a copy-then-leave pair as one line", () => {
    const f: ReportFlag = {
      ...open,
      rule: "copy_then_leave",
      events: [
        { kind: "copied", at: away(0), chars: 340 },
        { kind: "left_window", at: away(4) },
      ],
      media: [],
    };
    renderSection({ flags: [f] });
    const items = within(screen.getByRole("list", { name: "Evidence" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Copied 340 characters, then left the window 4 s later");
  });

  it("words a full screen downtime gap", () => {
    const f: ReportFlag = {
      ...open,
      rule: "downtime",
      events: [{ kind: "monitoring_down", at: "2026-11-10T10:05:00.000Z", source: "fullscreen", downMs: 20_000, endAt: "2026-11-10T10:05:20.000Z", closedBy: "reconnected" }],
      media: [],
    };
    renderSection({ flags: [f] });
    expect(screen.getByRole("list", { name: "Evidence" })).toHaveTextContent("Left full screen for 20 s (back on)");
  });

  it("shows a filmstrip per departure with offsets and alt text", () => {
    renderSection({ flags: [leave] });
    const strip = screen.getByRole("list", { name: "Screenshots while away" });
    const imgs = within(strip).getAllByRole("img");
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["Screen 2 s after leaving", "Camera 3 s after leaving", "Screen 6 s after leaving", "Screen when back"]);
    expect(strip).toHaveTextContent("+2 s");
    expect(strip).toHaveTextContent("+6 s");
    expect(strip).toHaveTextContent("back");
    expect(imgs[0].closest("a")).toHaveAttribute("href", "https://storage.test/1.jpg");
  });

  it("hides the filmstrip when media may not be seen", () => {
    renderSection({ flags: [leave], canSeeMedia: false });
    expect(screen.queryByRole("list", { name: "Screenshots while away" })).toBeNull();
  });

  it("renders audio evidence as a labelled player", () => {
    const f: ReportFlag = { ...open, rule: "speech", events: [], media: [media(9, 10, "audio", "speech")] };
    const { container } = renderSection({ flags: [f] });
    const audio = container.querySelector("audio")!;
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "none");
    expect(audio).toHaveAttribute("src", "https://storage.test/9.webm");
    expect(audio).toHaveAttribute("aria-label", expect.stringContaining("Audio clip (speech heard)"));
    expect(screen.getByText(/Audio clip \(speech heard\)/)).toBeVisible();
    expect(screen.queryAllByRole("img")).toEqual([]);
  });
});
