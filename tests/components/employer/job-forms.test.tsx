/** Jobs page client form: create a job with an assessment and an invite deadline, in the Create job dialog. */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, formDataOf } from "../helpers";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/app/[orgSlug]/jobs/actions", () => ({ createJob: vi.fn() }));

const actions = await import("@/app/app/[orgSlug]/jobs/actions");
const { CreateJobDialog, CreateJobForm } = await import("@/app/app/[orgSlug]/jobs/job-forms");
const createJob = vi.mocked(actions.createJob);

const assessments = [
  { id: "as-1", title: "Staff accountant screen" },
  { id: "as-2", title: "AP clerk screen", label: "AP clerk screen (Petty cash, 15 min)" },
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
const roleName = () => screen.getByRole("textbox", { name: "Role name" });
const submit = () => screen.getByRole("button", { name: "Create and invite candidates" });

describe("CreateJobForm", () => {
  it("defaults to the first assessment and a deadline two weeks out, no earlier than today", () => {
    render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    expect(roleName()).toBeRequired();
    expect(roleName()).toHaveAccessibleDescription("Candidates see this on their invite.");
    expect(screen.getByRole("combobox", { name: "Assessment" })).toHaveValue("as-1");
    // An assessment's label adds its simulation and length.
    expect(screen.getByRole("option", { name: "AP clerk screen (Petty cash, 15 min)" })).toBeInTheDocument();
    const date = screen.getByLabelText("Invites close");
    expect(date).toHaveValue("2026-11-23");
    expect(date).toHaveAttribute("min", "2026-11-09");
    expect(date).toHaveAccessibleDescription("Invites expire at the end of this day, in your time zone.");
  });

  it("can start on a chosen assessment and links to the library", () => {
    render(<CreateJobForm orgId="org-1" assessments={assessments} defaultAssessmentId="as-2" libraryHref="/app/acme/jobs/assessments" />);
    expect(screen.getByRole("combobox", { name: "Assessment" })).toHaveValue("as-2");
    expect(screen.getByRole("link", { name: "Browse the library" })).toHaveAttribute("href", "/app/acme/jobs/assessments");
  });

  it("sends the end of the picked day in the browser's time zone", async () => {
    const user = userEvent.setup();
    const { container } = render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    const date = screen.getByLabelText("Invites close");
    await user.clear(date);
    await user.type(date, "2026-12-01");
    const deadline = new Date(hiddenDeadline(container));
    expect([deadline.getFullYear(), deadline.getMonth(), deadline.getDate()]).toEqual([2026, 11, 1]);
    expect([deadline.getHours(), deadline.getMinutes(), deadline.getSeconds()]).toEqual([23, 59, 59]);
  });

  it("sends no deadline when the date is cleared", async () => {
    const user = userEvent.setup();
    const { container } = render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.clear(screen.getByLabelText("Invites close"));
    expect(hiddenDeadline(container)).toBe("");
  });

  it("submits the job, shows Creating… while it runs, then opens the new job's invite page", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string; id: string }>();
    createJob.mockReturnValueOnce(pending.promise);
    const { container } = render(<CreateJobForm orgId="org-1" assessments={assessments} jobsBase="/app/acme/jobs" />);
    await user.type(roleName(), "Audit intern");
    await user.selectOptions(screen.getByRole("combobox", { name: "Assessment" }), "as-2");
    const deadline = hiddenDeadline(container);
    await user.click(submit());

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(formDataOf(createJob)).toEqual({
      orgId: "org-1",
      deadline,
      title: "Audit intern",
      assessmentId: "as-2",
      deadlineDate: "2026-11-23",
    });
    await act(async () => pending.resolve({ message: 'Created "Audit intern". Open it to invite candidates.', id: "job-7" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/app/acme/jobs/job-7/invite"));
    // It stays busy while the invite page loads.
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("shows the result in place when there's nowhere to go", async () => {
    const user = userEvent.setup();
    createJob.mockResolvedValueOnce({ message: 'Created "Audit intern". Open it to invite candidates.', id: "job-7" });
    render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.type(roleName(), "Audit intern");
    await user.click(submit());
    expect(await screen.findByText('Created "Audit intern". Open it to invite candidates.')).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows validation messages on the role name, assessment and deadline", async () => {
    const user = userEvent.setup();
    createJob.mockResolvedValueOnce({
      fieldErrors: { title: ["Give the job a title."], assessmentId: ["Pick an assessment."], deadline: ["Pick a date in the future."] },
    });
    render(<CreateJobForm orgId="org-1" assessments={assessments} />);
    await user.type(roleName(), "x");
    await user.click(submit());
    await waitFor(() => expect(roleName()).toHaveAccessibleDescription("Candidates see this on their invite. Give the job a title."));
    expect(screen.getByLabelText("Invites close")).toHaveAccessibleDescription("Invites expire at the end of this day, in your time zone. Pick a date in the future.");
    expect(screen.getByText("Pick an assessment.")).toBeVisible();
  });

  it("shows a form-level error", async () => {
    const user = userEvent.setup();
    createJob.mockResolvedValueOnce({ error: "You have read-only access." });
    render(<CreateJobForm orgId="org-1" assessments={assessments} jobsBase="/app/acme/jobs" />);
    await user.type(roleName(), "x");
    await user.click(submit());
    expect(await screen.findByText("You have read-only access.")).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("CreateJobDialog", () => {
  const props = { orgId: "org-1", assessments, jobsBase: "/app/acme/jobs", libraryHref: "/app/acme/jobs/assessments" };

  it("opens from the Create job button and closes with Cancel, the close button or Escape", async () => {
    const user = userEvent.setup();
    render(<CreateJobDialog {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create job" }));
    expect(screen.getByRole("dialog", { name: "Create job" })).toBeVisible();
    expect(roleName()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create job" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create job" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can open straight away on a chosen assessment", () => {
    render(<CreateJobDialog {...props} defaultOpen defaultAssessmentId="as-2" />);
    expect(screen.getByRole("dialog", { name: "Create job" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Assessment" })).toHaveValue("as-2");
  });
});
