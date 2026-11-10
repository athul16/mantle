/** Candidate report client forms: rubric review, add note, delete note. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, formDataOf } from "../helpers";

vi.mock("@/app/app/[orgSlug]/candidates/actions", () => ({
  reviewRubricStep: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
}));

const actions = await import("@/app/app/[orgSlug]/candidates/actions");
const { RubricReviewForm, AddNoteForm, DeleteNoteButton } = await import("@/app/app/[orgSlug]/candidates/[inviteId]/report-forms");
const reviewRubricStep = vi.mocked(actions.reviewRubricStep);
const addNote = vi.mocked(actions.addNote);
const deleteNote = vi.mocked(actions.deleteNote);

beforeEach(() => vi.clearAllMocks());

const criteria = [
  { id: "timing", label: "Explains timing", max: 3, earned: 0 },
  { id: "tone", label: "Tone", max: 2, earned: 0 },
];

describe("RubricReviewForm", () => {
  it("asks for points per criterion within each range", () => {
    render(<RubricReviewForm orgId="o" attemptId="a" stepId="reply" stepTitle="Reply to Marcus" criteria={criteria} reviewed={false} />);
    expect(screen.getByRole("form", { name: "Review Reply to Marcus" })).toBeVisible();
    expect(screen.getByText("Enter rubric scores")).toBeVisible();
    const timing = screen.getByRole("spinbutton", { name: /Explains timing \(0–3\)/ });
    expect(timing).toHaveAttribute("min", "0");
    expect(timing).toHaveAttribute("max", "3");
    expect(timing).toBeRequired();
    expect(timing).toHaveValue(null);
  });

  it("prefills earlier scores when changing a review", () => {
    render(
      <RubricReviewForm
        orgId="o"
        attemptId="a"
        stepId="reply"
        stepTitle="Reply"
        criteria={[{ ...criteria[0], earned: 2.5 }, criteria[1]]}
        reviewed
      />,
    );
    expect(screen.getByText("Change the rubric scores")).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: /Explains timing/ })).toHaveValue(2.5);
  });

  it("submits score:<id> fields, shows Saving… and then the result", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    reviewRubricStep.mockReturnValueOnce(pending.promise);
    render(<RubricReviewForm orgId="org-1" attemptId="att-1" stepId="reply" stepTitle="Reply" criteria={criteria} reviewed={false} />);

    await user.type(screen.getByRole("spinbutton", { name: /Explains timing/ }), "2.5");
    await user.type(screen.getByRole("spinbutton", { name: /Tone/ }), "2");
    await user.click(screen.getByRole("button", { name: "Save review" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(formDataOf(reviewRubricStep)).toEqual({ orgId: "org-1", attemptId: "att-1", stepId: "reply", "score:timing": "2.5", "score:tone": "2" });
    pending.resolve({ message: "Review saved. The final score is updated." });
    expect(await screen.findByText("Review saved. The final score is updated.")).toBeVisible();
  });

  it("shows server errors per field and overall", async () => {
    const user = userEvent.setup();
    reviewRubricStep.mockResolvedValueOnce({ fieldErrors: { "score:tone": ["Enter a number."] } });
    render(<RubricReviewForm orgId="o" attemptId="a" stepId="reply" stepTitle="Reply" criteria={criteria} reviewed={false} />);
    await user.type(screen.getByRole("spinbutton", { name: /Explains timing/ }), "1");
    await user.type(screen.getByRole("spinbutton", { name: /Tone/ }), "1");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByText("Enter a number.")).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: /Tone/ })).toHaveAttribute("aria-invalid", "true");

    reviewRubricStep.mockResolvedValueOnce({ error: "You don't have permission to do that." });
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByText("You don't have permission to do that.")).toBeVisible();
  });
});

describe("AddNoteForm", () => {
  it("sends the note and vote", async () => {
    const user = userEvent.setup();
    addNote.mockResolvedValueOnce({ message: "Note added." });
    render(<AddNoteForm orgId="org-1" attemptId="att-1" />);
    expect(screen.getByRole("radio", { name: "No vote" })).toBeChecked();

    await user.type(screen.getByRole("textbox", { name: "Add a note" }), "Strong reconciliation");
    await user.click(screen.getByRole("radio", { name: "Hire" }));
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("Note added.")).toBeVisible();
    expect(formDataOf(addNote)).toEqual({ orgId: "org-1", attemptId: "att-1", body: "Strong reconciliation", vote: "hire" });
  });

  it("shows a validation error from the server", async () => {
    const user = userEvent.setup();
    addNote.mockResolvedValueOnce({ fieldErrors: { body: ["Write a note or pick a vote."] } });
    render(<AddNoteForm orgId="o" attemptId="a" />);
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Write a note or pick a vote.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Add a note" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("DeleteNoteButton", () => {
  it("deletes the note and shows an error if that fails", async () => {
    const user = userEvent.setup();
    deleteNote.mockResolvedValueOnce({ error: "Could not delete the note." });
    render(<DeleteNoteButton orgId="org-1" noteId="note-1" />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(formDataOf(deleteNote)).toEqual({ orgId: "org-1", noteId: "note-1" }));
    expect(await screen.findByText("Could not delete the note.")).toBeVisible();
  });
});
