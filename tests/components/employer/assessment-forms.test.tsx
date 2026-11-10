/** Assessments page client forms: create, edit settings, clone. */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentSummary } from "@/lib/jobs/queries";
import { deferred, formDataOf } from "../helpers";

vi.mock("@/app/app/[orgSlug]/jobs/actions", () => ({
  createAssessment: vi.fn(),
  updateAssessment: vi.fn(),
  cloneAssessment: vi.fn(),
  createJob: vi.fn(),
}));

const actions = await import("@/app/app/[orgSlug]/jobs/actions");
const { CloneAssessmentButton, CreateAssessmentForm, EditAssessmentForm } = await import(
  "@/app/app/[orgSlug]/jobs/assessments/assessment-forms"
);
const createAssessment = vi.mocked(actions.createAssessment);
const updateAssessment = vi.mocked(actions.updateAssessment);
const cloneAssessment = vi.mocked(actions.cloneAssessment);

const scenarios = [
  { id: "sc-1", label: "Petty cash count (v1)", minutes: 30 },
  { id: "sc-2", label: "Mini month-end close (v1)", minutes: 60 },
];

const assessment: AssessmentSummary = {
  id: "as-1",
  title: "Staff accountant screen",
  scenarioId: "sc-2",
  scenarioTitle: "Mini month-end close (v1)",
  timeLimitMinutes: 50,
  passScore: 70,
  proctoring: { camera: false, screen: true },
  lockedAt: null,
  createdAt: "2026-11-01T10:00:00Z",
};

beforeEach(() => vi.clearAllMocks());

describe("CreateAssessmentForm", () => {
  it("picks the first simulation and suggests its time limit", () => {
    render(<CreateAssessmentForm orgId="org-1" scenarios={scenarios} />);
    expect(screen.getByRole("combobox", { name: "Simulation" })).toHaveValue("sc-1");
    expect(screen.getByRole("spinbutton", { name: "Time limit (minutes)" })).toHaveValue(30);
    expect(screen.getByRole("spinbutton", { name: "Pass score (%)" })).toHaveValue(null);
    expect(screen.getByRole("textbox", { name: "Title" })).toBeRequired();
    expect(screen.getByRole("checkbox", { name: "Camera snapshots" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Screen share" })).toBeChecked();
  });

  it("updates the suggested time limit when the simulation changes", async () => {
    const user = userEvent.setup();
    render(<CreateAssessmentForm orgId="org-1" scenarios={scenarios} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Simulation" }), "Mini month-end close (v1)");
    expect(screen.getByRole("spinbutton", { name: "Time limit (minutes)" })).toHaveValue(60);
  });

  it("limits the time and pass score inputs", () => {
    render(<CreateAssessmentForm orgId="org-1" scenarios={scenarios} />);
    const minutes = screen.getByRole("spinbutton", { name: "Time limit (minutes)" });
    expect(minutes).toHaveAttribute("min", "1");
    expect(minutes).toHaveAttribute("max", "240");
    const pass = screen.getByRole("spinbutton", { name: "Pass score (%)" });
    expect(pass).toHaveAttribute("min", "0");
    expect(pass).toHaveAttribute("max", "100");
  });

  it("falls back to 45 minutes with no simulations", () => {
    render(<CreateAssessmentForm orgId="org-1" scenarios={[]} />);
    expect(screen.getByRole("spinbutton", { name: "Time limit (minutes)" })).toHaveValue(45);
  });

  it("submits the settings and shows Creating… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    createAssessment.mockReturnValueOnce(pending.promise);
    render(<CreateAssessmentForm orgId="org-1" scenarios={scenarios} />);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Junior AP screen");
    await user.clear(screen.getByRole("spinbutton", { name: "Time limit (minutes)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Time limit (minutes)" }), "40");
    await user.type(screen.getByRole("spinbutton", { name: "Pass score (%)" }), "65");
    await user.click(screen.getByRole("checkbox", { name: "Camera snapshots" }));
    await user.click(screen.getByRole("button", { name: "Create assessment" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(formDataOf(createAssessment)).toEqual({
      orgId: "org-1",
      scenarioId: "sc-1",
      title: "Junior AP screen",
      timeLimitMinutes: "40",
      passScore: "65",
      screen: "on",
    });
    await act(async () => pending.resolve({ message: 'Created "Junior AP screen".' }));
    expect(await screen.findByText('Created "Junior AP screen".')).toBeVisible();
  });

  it("shows each field's validation message on that field", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({
      fieldErrors: {
        title: ["Give the assessment a title."],
        timeLimitMinutes: ["Between 1 and 240 minutes."],
        passScore: ["Between 0 and 100."],
        scenarioId: ["Pick a simulation."],
      },
    });
    render(<CreateAssessmentForm orgId="org-1" scenarios={scenarios} />);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "x");
    await user.click(screen.getByRole("button", { name: "Create assessment" }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" })).toHaveAccessibleDescription("Give the assessment a title."));
    expect(screen.getByRole("spinbutton", { name: "Time limit (minutes)" })).toHaveAccessibleDescription("Between 1 and 240 minutes.");
    expect(screen.getByRole("spinbutton", { name: "Pass score (%)" })).toHaveAccessibleDescription("Between 0 and 100.");
    expect(screen.getByText("Pick a simulation.")).toBeVisible();
  });

  it("shows a form-level error", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({ error: "Viewers can't create assessments." });
    render(<CreateAssessmentForm orgId="org-1" scenarios={scenarios} />);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "x");
    await user.click(screen.getByRole("button", { name: "Create assessment" }));
    expect(await screen.findByText("Viewers can't create assessments.")).toBeVisible();
  });
});

describe("EditAssessmentForm", () => {
  it("starts closed behind an Edit settings button", () => {
    render(<EditAssessmentForm orgId="org-1" assessment={assessment} />);
    expect(screen.getByRole("button", { name: "Edit settings" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  });

  it("opens with the saved settings filled in, and closes again", async () => {
    const user = userEvent.setup();
    render(<EditAssessmentForm orgId="org-1" assessment={assessment} />);
    await user.click(screen.getByRole("button", { name: "Edit settings" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Staff accountant screen");
    expect(screen.getByRole("spinbutton", { name: "Time limit (minutes)" })).toHaveValue(50);
    expect(screen.getByRole("spinbutton", { name: "Pass score (%)" })).toHaveValue(70);
    expect(screen.getByRole("checkbox", { name: "Camera snapshots" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Screen share" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Edit settings" })).toBeVisible();
  });

  it("leaves the pass score empty when there is none", async () => {
    const user = userEvent.setup();
    render(<EditAssessmentForm orgId="org-1" assessment={{ ...assessment, passScore: null }} />);
    await user.click(screen.getByRole("button", { name: "Edit settings" }));
    expect(screen.getByRole("spinbutton", { name: "Pass score (%)" })).toHaveValue(null);
  });

  it("saves the changed settings for this assessment", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    updateAssessment.mockReturnValueOnce(pending.promise);
    render(<EditAssessmentForm orgId="org-1" assessment={assessment} />);
    await user.click(screen.getByRole("button", { name: "Edit settings" }));
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Senior screen");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(formDataOf(updateAssessment)).toEqual({
      orgId: "org-1",
      assessmentId: "as-1",
      title: "Senior screen",
      timeLimitMinutes: "50",
      passScore: "70",
      screen: "on",
    });
    await act(async () => pending.resolve({ message: "Saved." }));
    expect(await screen.findByText("Saved.")).toBeVisible();
  });

  it("shows the locked error the server returns", async () => {
    const user = userEvent.setup();
    updateAssessment.mockResolvedValueOnce({ error: "This assessment is locked because a candidate started. Clone it to change settings." });
    render(<EditAssessmentForm orgId="org-1" assessment={assessment} />);
    await user.click(screen.getByRole("button", { name: "Edit settings" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/locked because a candidate started/)).toBeVisible();
  });
});

describe("CloneAssessmentButton", () => {
  it("clones the assessment, showing Cloning… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    cloneAssessment.mockReturnValueOnce(pending.promise);
    render(<CloneAssessmentButton orgId="org-1" assessmentId="as-1" />);
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(await screen.findByRole("button", { name: "Cloning…" })).toBeDisabled();
    expect(formDataOf(cloneAssessment)).toEqual({ orgId: "org-1", assessmentId: "as-1" });
    await act(async () => pending.resolve(undefined));
    expect(await screen.findByRole("button", { name: "Clone" })).toBeEnabled();
  });

  it("shows an error when cloning fails", async () => {
    const user = userEvent.setup();
    cloneAssessment.mockResolvedValueOnce({ error: "Couldn't clone that assessment." });
    render(<CloneAssessmentButton orgId="org-1" assessmentId="as-1" />);
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(await screen.findByText("Couldn't clone that assessment.")).toBeVisible();
  });
});
