/** Team page client forms: invite a teammate, change a role, remove or leave. */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, formDataOf } from "../helpers";

vi.mock("@/app/app/[orgSlug]/team/actions", () => ({
  inviteTeammate: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
}));

const actions = await import("@/app/app/[orgSlug]/team/actions");
const { InviteForm, MemberControls } = await import("@/app/app/[orgSlug]/team/team-forms");
const inviteTeammate = vi.mocked(actions.inviteTeammate);
const changeRole = vi.mocked(actions.changeRole);
const removeMember = vi.mocked(actions.removeMember);

type ControlsProps = Parameters<typeof MemberControls>[0];
/** MemberControls renders the role, two-factor and actions cells of a team table row. */
function renderControls(props: Omit<ControlsProps, "email" | "pending" | "twoFactor"> & Partial<ControlsProps>) {
  return render(
    <table>
      <tbody>
        <tr>
          <MemberControls email="sam@example.com" pending={false} twoFactor={null} {...props} />
        </tr>
      </tbody>
    </table>,
  );
}
const ROLE = { name: "Role for sam@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("InviteForm", () => {
  it("has an email field and a role picker that defaults to Recruiter", () => {
    render(<InviteForm orgId="org-1" />);
    expect(screen.getByRole("heading", { name: "Invite a teammate" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeRequired();
    const role = screen.getByRole("combobox", { name: "Role" });
    expect(role).toHaveValue("recruiter");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Admin", "Recruiter", "Viewer"]);
  });

  it("sends the org, email and chosen role, and shows Inviting… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string }>();
    inviteTeammate.mockReturnValueOnce(pending.promise);
    render(<InviteForm orgId="org-1" />);

    await user.type(screen.getByRole("textbox", { name: "Email" }), "sam@example.com");
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "Viewer");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByRole("button", { name: "Inviting…" })).toBeDisabled();
    expect(formDataOf(inviteTeammate)).toEqual({ orgId: "org-1", email: "sam@example.com", role: "viewer" });

    await act(async () => pending.resolve({ message: "Invite sent to sam@example.com." }));
    expect(await screen.findByText("Invite sent to sam@example.com.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeEnabled();
  });

  it("shows a field error on the email input", async () => {
    const user = userEvent.setup();
    inviteTeammate.mockResolvedValueOnce({ fieldErrors: { email: ["Enter a valid email."] } });
    render(<InviteForm orgId="org-1" />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "x@y.z");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    const email = await screen.findByRole("textbox", { name: "Email" });
    await waitFor(() => expect(email).toHaveAccessibleDescription("Enter a valid email."));
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a form-level error", async () => {
    const user = userEvent.setup();
    inviteTeammate.mockResolvedValueOnce({ error: "Only admins can invite teammates." });
    render(<InviteForm orgId="org-1" />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "a@b.co");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Only admins can invite teammates.")).toBeVisible();
  });
});

describe("MemberControls", () => {
  it("shows the member's current role and a Remove button", () => {
    renderControls({ orgId: "org-1", userId: "u-2", role: "viewer", isSelf: false });
    expect(screen.getByRole("combobox", ROLE)).toHaveValue("viewer");
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("saves as soon as a new role is picked", async () => {
    const user = userEvent.setup();
    changeRole.mockResolvedValueOnce(undefined);
    renderControls({ orgId: "org-1", userId: "u-2", role: "viewer", isSelf: false });
    await user.selectOptions(screen.getByRole("combobox", ROLE), "Admin");
    await waitFor(() => expect(changeRole).toHaveBeenCalledTimes(1));
    expect(formDataOf(changeRole)).toEqual({ orgId: "org-1", userId: "u-2", role: "admin" });
  });

  it("disables the role picker while saving", async () => {
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    changeRole.mockReturnValueOnce(pending.promise);
    renderControls({ orgId: "org-1", userId: "u-2", role: "viewer", isSelf: false });
    await user.selectOptions(screen.getByRole("combobox", ROLE), "Recruiter");
    await waitFor(() => expect(screen.getByRole("combobox", ROLE)).toBeDisabled());
    await act(async () => pending.resolve(undefined));
    await waitFor(() => expect(screen.getByRole("combobox", ROLE)).toBeEnabled());
  });

  it("snaps back to the saved role and shows why when a change is rejected", async () => {
    const user = userEvent.setup();
    changeRole.mockResolvedValueOnce({ error: "A company needs at least one admin." });
    renderControls({ orgId: "org-1", userId: "u-1", role: "admin", isSelf: true });
    await user.selectOptions(screen.getByRole("combobox", ROLE), "Viewer");
    expect(await screen.findByText("A company needs at least one admin.")).toBeVisible();
    expect(screen.getByRole("combobox", ROLE)).toHaveValue("admin");
  });

  it("asks before removing someone and does nothing if cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    renderControls({ orgId: "org-1", userId: "u-2", role: "recruiter", isSelf: false });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledWith("Remove this person from the company?");
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("removes after confirming, and shows an error if it fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    removeMember.mockResolvedValueOnce({ error: "You can't remove the last admin." });
    renderControls({ orgId: "org-1", userId: "u-2", role: "admin", isSelf: false });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("You can't remove the last admin.")).toBeVisible();
    expect(formDataOf(removeMember)).toEqual({ orgId: "org-1", userId: "u-2" });
  });

  it("disables Remove while it runs", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const pending = deferred<undefined>();
    removeMember.mockReturnValueOnce(pending.promise);
    renderControls({ orgId: "org-1", userId: "u-2", role: "admin", isSelf: false });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled());
    await act(async () => pending.resolve(undefined));
  });

  it("offers Leave on your own row, with a warning", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    renderControls({ orgId: "org-1", userId: "me", role: "recruiter", isSelf: true });
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(confirm).toHaveBeenCalledWith("Remove yourself from this company? You'll lose access.");
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("offers Cancel on a pending invite, with its own warning", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    renderControls({ orgId: "org-1", userId: "u-3", role: "viewer", isSelf: false, pending: true });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith("Cancel the invite to sam@example.com?");
    expect(removeMember).not.toHaveBeenCalled();
  });
});
