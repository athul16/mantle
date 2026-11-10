/** Jobs page client form: create a job with an assessment and an invite deadline. */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, formDataOf } from "../helpers";

vi.mock("@/app/app/[orgSlug]/jobs/actions", () => ({ createJob: vi.fn() }));

const actions = await import("@/app/app/[orgSlug]/jobs/actions");
const { CreateJobForm } = await import("@/app/app/[orgSlug]/jobs/job-forms");
const createJob = vi.mocked(actions.createJob);

const assessments = [
  { id: "as-1", title: "Staff accountant screen" },
  { id: "as-2", title: "AP clerk screen" },
];

// Local noon on 9 Nov 2026, so "today" and "+14 days" are the same in every time zone.
const NOW = new Date(2026, 10, 9, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const hiddenDeadline = (container: HTMLElement) => (container.querySelector('input[name="deadline"]') as HTMLInputElement).value;

describe("CreateJobForm", () => {
  it("defaults to the first assessment and a deadline two weeks out, no earlier than today", () => {
    render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    expect(screen.getByRole("textbox", { name: "Job title" })).toBeRequired();
    expect(screen.getByRole("combobox", { name: "Assessment" })).toHaveValue("as-1");
    const date = screen.getByLabelText("Invite deadline");
    expect(date).toHaveValue("2026-11-23");
    expect(date).toHaveAttribute("min", "2026-11-09");
    expect(screen.getByText("Invites expire at the end of the deadline day, in your time zone.")).toBeVisible();
  });

  it("sends the end of the picked day in the browser's time zone", async () => {
    const user = userEvent.setup();
    const { container } = render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    const date = screen.getByLabelText("Invite deadline");
    await user.clear(date);
    await user.type(date, "2026-12-01");
    const deadline = new Date(hiddenDeadline(container));
    expect([deadline.getFullYear(), deadline.getMonth(), deadline.getDate()]).toEqual([2026, 11, 1]);
    expect([deadline.getHours(), deadline.getMinutes(), deadline.getSeconds()]).toEqual([23, 59, 59]);
  });

  it("sends no deadline when the date is cleared", async () => {
    const user = userEvent.setup();
    const { container } = render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.clear(screen.getByLabelText("Invite deadline"));
    expect(hiddenDeadline(container)).toBe("");
  });

  it("submits the job and shows Creating… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    createJob.mockReturnValueOnce(pending.promise);
    const { container } = render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.type(screen.getByRole("textbox", { name: "Job title" }), "Audit intern");
    await user.selectOptions(screen.getByRole("combobox", { name: "Assessment" }), "AP clerk screen");
    const deadline = hiddenDeadline(container);
    await user.click(screen.getByRole("button", { name: "Create job" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(formDataOf(createJob)).toEqual({
      orgId: "org-1",
      deadline,
      title: "Audit intern",
      assessmentId: "as-2",
      deadlineDate: "2026-11-23",
    });
    await act(async () => pending.resolve({ message: 'Created "Audit intern". Open it to invite candidates.' }));
    expect(await screen.findByText('Created "Audit intern". Open it to invite candidates.')).toBeVisible();
  });

  it("shows validation messages on the title, assessment and deadline", async () => {
    const user = userEvent.setup();
    createJob.mockResolvedValueOnce({
      fieldErrors: { title: ["Give the job a title."], assessmentId: ["Pick an assessment."], deadline: ["Pick a date in the future."] },
    });
    render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.type(screen.getByRole("textbox", { name: "Job title" }), "x");
    await user.click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Job title" })).toHaveAccessibleDescription("Give the job a title."));
    expect(screen.getByLabelText("Invite deadline")).toHaveAccessibleDescription("Pick a date in the future.");
    expect(screen.getByText("Pick an assessment.")).toBeVisible();
  });

  it("shows a form-level error", async () => {
    const user = userEvent.setup();
    createJob.mockResolvedValueOnce({ error: "You have read-only access." });
    render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.type(screen.getByRole("textbox", { name: "Job title" }), "x");
    await user.click(screen.getByRole("button", { name: "Create job" }));
    expect(await screen.findByText("You have read-only access.")).toBeVisible();
  });
});
