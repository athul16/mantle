/** Configure assessment screen (create from the library, edit, locked, read-only) and the clone button. */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentSummary } from "@/lib/jobs/queries";
import { deferred, formDataOf } from "../helpers";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/app/[orgSlug]/jobs/actions", () => ({
  createAssessment: vi.fn(),
  updateAssessment: vi.fn(),
  cloneAssessment: vi.fn(),
  createJob: vi.fn(),
}));

const actions = await import("@/app/app/[orgSlug]/jobs/actions");
const { CloneAssessmentButton, ConfigureAssessmentForm } = await import("@/app/app/[orgSlug]/jobs/assessments/assessment-forms");
const createAssessment = vi.mocked(actions.createAssessment);
const updateAssessment = vi.mocked(actions.updateAssessment);
const cloneAssessment = vi.mocked(actions.cloneAssessment);

const assessment: AssessmentSummary = {
  id: "as-1",
  title: "Staff accountant screen",
  scenarioId: "sc-2",
  scenarioTitle: "Mini month-end close (v1)",
  timeLimitMinutes: 50,
  passScore: 70,
  proctoring: { camera: false, screen: true, fullscreen: false, microphone: false, gaze: false},
  lockedAt: null,
  createdAt: "2026-11-01T10:00:00Z",
};

const base = { orgId: "org-1", cancelHref: "/app/acme/jobs/assessments", jobsBase: "/app/acme/jobs" };
const create = { kind: "create" as const, scenarioId: "sc-1", recommendedMinutes: 30, defaultTitle: "Petty cash count" };
const edit = (a: AssessmentSummary = assessment) => ({ kind: "edit" as const, assessment: a, recommendedMinutes: 20 });

const name = () => screen.getByRole("textbox", { name: "Assessment name" });
const timeLimit = () => screen.getByRole("combobox", { name: "Time limit" });
const passScore = () => screen.getByRole("spinbutton", { name: "Pass score" });
const toggle = (label: string) => screen.getByRole("switch", { name: label });

beforeEach(() => vi.clearAllMocks());

describe("ConfigureAssessmentForm: from the library", () => {
  it("starts from the simulation's name and recommended length", () => {
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    expect(name()).toHaveValue("Petty cash count");
    expect(name()).toBeRequired();
    expect(timeLimit()).toHaveValue("30");
    expect(screen.getByRole("option", { name: "30 minutes (recommended)" })).toBeInTheDocument();
    expect(screen.getByText("Designed for 30 minutes")).toBeVisible();
    expect(passScore()).toHaveValue(null);
    expect(passScore()).toHaveAttribute("min", "0");
    expect(passScore()).toHaveAttribute("max", "100");
    // The activity log is always recorded.
    expect(toggle("Activity log (always on)")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/acme/jobs/assessments");
  });

  it("asks Monitored or Not monitored with nothing preselected, and explains each", () => {
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    const group = screen.getByRole("group", { name: "Proctoring" });
    const monitored = within(group).getByRole("radio", { name: "Monitored" });
    const notMonitored = within(group).getByRole("radio", { name: "Not monitored" });
    expect(monitored).not.toBeChecked();
    expect(notMonitored).not.toBeChecked();
    expect(monitored).toBeRequired();
    expect(monitored).toHaveAccessibleDescription(/camera photos and\/or screen screenshots/);
    expect(notMonitored).toHaveAccessibleDescription(/No camera or screen capture/);
    expect(screen.queryByRole("switch", { name: "Camera snapshots" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Entire-screen sharing" })).not.toBeInTheDocument();
  });

  it("shows camera and screen options, off, only once Monitored is picked", async () => {
    const user = userEvent.setup();
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    await user.click(screen.getByRole("radio", { name: "Monitored" }));
    expect(toggle("Camera snapshots")).toHaveAttribute("aria-checked", "false");
    expect(toggle("Entire-screen sharing")).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("radio", { name: "Not monitored" }));
    expect(screen.queryByRole("switch", { name: "Camera snapshots" })).not.toBeInTheDocument();
  });

  it("offers full screen, microphone and gaze under Monitored; gaze needs the camera", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({ message: "Created.", id: "as-9" });
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    expect(screen.queryByRole("switch", { name: "Require full screen" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Monitored" }));
    const gaze = "Gaze check (on-device: facing the screen, number of faces)";
    expect(toggle("Require full screen")).toHaveAttribute("aria-checked", "false");
    expect(toggle("Microphone (audio clips when speech is heard)")).toHaveAttribute("aria-checked", "false");
    expect(toggle(gaze)).toBeDisabled();
    await user.click(toggle("Camera snapshots"));
    expect(toggle(gaze)).toBeEnabled();
    await user.click(toggle(gaze));
    await user.click(toggle("Require full screen"));
    await user.click(toggle("Microphone (audio clips when speech is heard)"));
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));
    await waitFor(() => expect(createAssessment).toHaveBeenCalled());
    expect(formDataOf(createAssessment)).toMatchObject({ monitoring: "monitored", camera: "on", fullscreen: "on", microphone: "on", gaze: "on" });
  });

  it("turning the camera off turns gaze off and stops sending it", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({ message: "Created.", id: "as-9" });
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    await user.click(screen.getByRole("radio", { name: "Monitored" }));
    await user.click(toggle("Camera snapshots"));
    await user.click(toggle("Gaze check (on-device: facing the screen, number of faces)"));
    await user.click(toggle("Camera snapshots"));
    expect(toggle("Gaze check (on-device: facing the screen, number of faces)")).toHaveAttribute("aria-checked", "false");
    await user.click(toggle("Microphone (audio clips when speech is heard)"));
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));
    await waitFor(() => expect(createAssessment).toHaveBeenCalled());
    expect(formDataOf(createAssessment)).not.toHaveProperty("gaze");
    expect(formDataOf(createAssessment)).not.toHaveProperty("camera");
  });

  it("a microphone-only assessment opens as Monitored with its switches set", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit({ ...assessment, proctoring: { camera: false, screen: false, fullscreen: true, microphone: true, gaze: false } })} />);
    expect(screen.getByRole("radio", { name: "Monitored" })).toBeChecked();
    expect(toggle("Microphone (audio clips when speech is heard)")).toHaveAttribute("aria-checked", "true");
    expect(toggle("Require full screen")).toHaveAttribute("aria-checked", "true");
  });

  it("submits Not monitored with no camera or screen fields", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({ message: "Created.", id: "as-9" });
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    await user.click(screen.getByRole("radio", { name: "Monitored" }));
    await user.click(toggle("Camera snapshots"));
    await user.click(screen.getByRole("radio", { name: "Not monitored" }));
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));
    await waitFor(() => expect(createAssessment).toHaveBeenCalled());
    expect(formDataOf(createAssessment)).toEqual({
      orgId: "org-1",
      scenarioId: "sc-1",
      title: "Petty cash count",
      timeLimitMinutes: "30",
      passScore: "",
      monitoring: "not_monitored",
    });
  });

  it("shows the server's proctoring error on the group", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({ fieldErrors: { monitoring: ["Choose whether candidates are monitored."] } });
    const { container } = render(<ConfigureAssessmentForm {...base} mode={create} />);
    container.querySelector("form")?.setAttribute("novalidate", "");
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));
    expect(await screen.findByRole("group", { name: "Proctoring" })).toHaveAccessibleDescription("Choose whether candidates are monitored.");
  });

  it("saves, shows Saving… while it runs, then opens Create job with the new assessment", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string; id: string }>();
    createAssessment.mockReturnValueOnce(pending.promise);
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    await user.clear(name());
    await user.type(name(), "Junior AP screen");
    await user.selectOptions(timeLimit(), "40");
    await user.type(passScore(), "65");
    await user.click(screen.getByRole("radio", { name: "Monitored" }));
    await user.click(toggle("Entire-screen sharing"));
    expect(toggle("Entire-screen sharing")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(formDataOf(createAssessment)).toEqual({
      orgId: "org-1",
      scenarioId: "sc-1",
      title: "Junior AP screen",
      timeLimitMinutes: "40",
      passScore: "65",
      monitoring: "monitored",
      screen: "on",
    });
    await act(async () => pending.resolve({ message: 'Created "Junior AP screen".', id: "as-9" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/app/acme/jobs?create=1&assessment=as-9"));
  });

  it("shows each field's validation message on that field", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({
      fieldErrors: {
        title: ["Give the assessment a title."],
        timeLimitMinutes: ["At most 240 minutes."],
        passScore: ["Between 0 and 100."],
      },
    });
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    await user.click(screen.getByRole("radio", { name: "Not monitored" }));
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));
    await waitFor(() => expect(name()).toHaveAccessibleDescription("Give the assessment a title."));
    expect(timeLimit()).toHaveAccessibleDescription("At most 240 minutes.");
    expect(passScore()).toHaveAccessibleDescription(/Between 0 and 100\.$/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a form-level error", async () => {
    const user = userEvent.setup();
    createAssessment.mockResolvedValueOnce({ error: "Viewers can't create assessments." });
    render(<ConfigureAssessmentForm {...base} mode={create} />);
    await user.click(screen.getByRole("radio", { name: "Not monitored" }));
    await user.click(screen.getByRole("button", { name: "Save and attach to a job" }));
    expect(await screen.findByText("Viewers can't create assessments.")).toBeVisible();
  });
});

describe("ConfigureAssessmentForm: an existing assessment", () => {
  it("fills in the saved settings, keeping an unusual length in the menu", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit()} />);
    expect(name()).toHaveValue("Staff accountant screen");
    expect(timeLimit()).toHaveValue("50");
    expect(screen.getByRole("option", { name: "20 minutes (recommended)" })).toBeInTheDocument();
    expect(passScore()).toHaveValue(70);
    expect(toggle("Camera snapshots")).toHaveAttribute("aria-checked", "false");
    expect(toggle("Entire-screen sharing")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Clone" })).toBeEnabled();
  });

  it("opens a monitored assessment with Monitored chosen", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit()} />);
    expect(screen.getByRole("radio", { name: "Monitored" })).toBeChecked();
  });

  it("opens an unmonitored assessment with Not monitored chosen", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit({ ...assessment, proctoring: { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false} })} />);
    expect(screen.getByRole("radio", { name: "Not monitored" })).toBeChecked();
    expect(screen.queryByRole("switch", { name: "Entire-screen sharing" })).not.toBeInTheDocument();
  });

  it("leaves the pass score empty when there is none", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit({ ...assessment, passScore: null })} />);
    expect(passScore()).toHaveValue(null);
  });

  it("saves the changed settings for this assessment", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    updateAssessment.mockReturnValueOnce(pending.promise);
    render(<ConfigureAssessmentForm {...base} mode={edit()} />);
    await user.clear(name());
    await user.type(name(), "Senior screen");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(formDataOf(updateAssessment)).toEqual({
      orgId: "org-1",
      assessmentId: "as-1",
      title: "Senior screen",
      timeLimitMinutes: "50",
      passScore: "70",
      monitoring: "monitored",
      screen: "on",
    });
    await act(async () => pending.resolve({ message: "Saved." }));
    expect(await screen.findByText("Saved.")).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows the locked error the server returns", async () => {
    const user = userEvent.setup();
    updateAssessment.mockResolvedValueOnce({ error: "A candidate has started this assessment, so its settings are locked. Clone it to change them." });
    render(<ConfigureAssessmentForm {...base} mode={edit()} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/its settings are locked/)).toBeVisible();
  });

  it("shows a locked assessment read-only, with Clone as the way forward", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit({ ...assessment, lockedAt: "2026-11-05T10:00:00Z" })} />);
    expect(name()).toBeDisabled();
    expect(timeLimit()).toBeDisabled();
    expect(toggle("Camera snapshots")).toBeDisabled();
    expect(toggle("Require full screen")).toBeDisabled();
    expect(toggle("Microphone (audio clips when speech is heard)")).toBeDisabled();
    expect(toggle("Gaze check (on-device: facing the screen, number of faces)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clone" })).toHaveClass("btn-primary");
    expect(screen.getByRole("link", { name: "Back" })).toBeVisible();
  });

  it("is read-only for a viewer: no save and no clone", () => {
    render(<ConfigureAssessmentForm {...base} mode={edit()} readOnly />);
    expect(name()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clone" })).not.toBeInTheDocument();
  });
});

describe("CloneAssessmentButton", () => {
  it("clones the assessment, showing Cloning… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    cloneAssessment.mockReturnValueOnce(pending.promise);
    render(<CloneAssessmentButton orgId="org-1" assessmentId="as-1" />);
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(await screen.findByRole("button", { name: "Cloning…" })).toBeDisabled();
    expect(formDataOf(cloneAssessment)).toEqual({ orgId: "org-1", assessmentId: "as-1" });
    await act(async () => pending.resolve({ message: 'Created "Staff accountant screen (copy)". Edit it before linking it to a job.' }));
    expect(await screen.findByRole("button", { name: "Clone" })).toBeEnabled();
    expect(screen.getByText(/\(copy\)/)).toBeVisible();
  });

  it("shows an error when cloning fails", async () => {
    const user = userEvent.setup();
    cloneAssessment.mockResolvedValueOnce({ error: "Couldn't clone that assessment." });
    render(<CloneAssessmentButton orgId="org-1" assessmentId="as-1" />);
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(await screen.findByText("Couldn't clone that assessment.")).toBeVisible();
  });
});
