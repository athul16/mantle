/** Job page client forms: invite candidates (paste or CSV), resend and revoke. */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, formDataOf } from "../helpers";

vi.mock("@/app/app/[orgSlug]/jobs/actions", () => ({
  inviteCandidates: vi.fn(),
  resendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));

const actions = await import("@/app/app/[orgSlug]/jobs/actions");
const { InviteCandidatesForm, InviteRowActions } = await import("@/app/app/[orgSlug]/jobs/[jobId]/invite-forms");
const inviteCandidates = vi.mocked(actions.inviteCandidates);
const resendInviteAction = vi.mocked(actions.resendInviteAction);
const revokeInviteAction = vi.mocked(actions.revokeInviteAction);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

const emailsBox = () => screen.getByRole("textbox", { name: "Paste emails" });
const csvInput = () => screen.getByLabelText(/or upload a CSV/) as HTMLInputElement;
const send = () => screen.getByRole("button", { name: "Send invites" });

describe("InviteCandidatesForm", () => {
  it("offers a paste box, a CSV upload and states the batch limit", () => {
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    expect(screen.getByRole("heading", { name: "Invite candidates" })).toBeVisible();
    expect(emailsBox()).toHaveValue("");
    expect(csvInput()).toHaveAttribute("type", "file");
    expect(csvInput()).toHaveAttribute("accept", ".csv,text/csv,text/plain");
    expect(screen.getByText(/Up to 200 candidates per batch/)).toBeVisible();
    expect(send()).toBeEnabled();
  });

  it("sends pasted emails and shows Sending invites… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string; invited: string[] }>();
    inviteCandidates.mockReturnValueOnce(pending.promise);
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.click(emailsBox());
    await user.paste("jane@example.com\nsam@example.com, lee@example.com");
    await user.click(send());

    expect(await screen.findByRole("button", { name: "Sending invites…" })).toBeDisabled();
    const sent = formDataOf(inviteCandidates);
    expect(sent).toMatchObject({ orgId: "org-1", jobId: "job-1", emails: "jane@example.com\nsam@example.com, lee@example.com" });

    await act(async () => pending.resolve({ message: "Invited 3 candidates.", invited: ["a", "b", "c"] }));
    expect(await screen.findByText("Invited 3 candidates.")).toBeVisible();
    // A successful batch clears the box.
    expect(emailsBox()).toHaveValue("");
  });

  it("sends an uploaded CSV file", async () => {
    const user = userEvent.setup();
    inviteCandidates.mockResolvedValueOnce({ message: "Invited 2 candidates." });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    const file = new File(["email,name\njane@example.com,Jane\nsam@example.com,Sam\n"], "candidates.csv", { type: "text/csv" });
    await user.upload(csvInput(), file);
    expect(csvInput().files?.[0]).toBe(file);
    await user.click(send());
    await waitFor(() => expect(inviteCandidates).toHaveBeenCalledTimes(1));
    // The form sends a "csv" file entry. jsdom builds FormData from its own file
    // list, not the one user-event sets, so the contents arrive empty here; the
    // real upload is covered end to end.
    expect(formDataOf(inviteCandidates).csv).toBeInstanceOf(File);
    expect(await screen.findByText("Invited 2 candidates.")).toBeVisible();
  });

  it("shows the 200 limit message and puts the pasted text back", async () => {
    const user = userEvent.setup();
    const pasted = Array.from({ length: 201 }, (_, i) => `c${i}@example.com`).join("\n");
    inviteCandidates.mockResolvedValueOnce({
      error: "That's 201 candidates. Invite at most 200 at a time. Nothing was sent.",
      emails: pasted,
    });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.click(emailsBox());
    await user.paste(pasted);
    await user.click(send());
    expect(await screen.findByText("That's 201 candidates. Invite at most 200 at a time. Nothing was sent.")).toBeVisible();
    expect(emailsBox()).toHaveValue(pasted);
  });

  it("lists invalid entries, at most 20, and counts the rest", async () => {
    const user = userEvent.setup();
    const invalid = Array.from({ length: 23 }, (_, i) => `bad-${i}`);
    inviteCandidates.mockResolvedValueOnce({ error: "Fix these 23 entries and try again. Nothing was sent.", invalid, emails: invalid.join("\n") });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.type(emailsBox(), "bad-0");
    await user.click(send());
    expect(await screen.findByText("Fix these 23 entries and try again. Nothing was sent.")).toBeVisible();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(21);
    expect(items.slice(0, 2)).toEqual(["bad-0", "bad-1"]);
    expect(items.at(-1)).toBe("…and 3 more");
  });

  it("shows no '…more' line for 20 or fewer invalid entries", async () => {
    const user = userEvent.setup();
    inviteCandidates.mockResolvedValueOnce({ error: "Fix this entry and try again. Nothing was sent.", invalid: ["nope"], emails: "nope" });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.type(emailsBox(), "nope");
    await user.click(send());
    expect(await screen.findByRole("listitem")).toHaveTextContent("nope");
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it("shows partial success: the summary, the failure and who wasn't delivered", async () => {
    const user = userEvent.setup();
    inviteCandidates.mockResolvedValueOnce({
      message: "Invited 1 candidate. Skipped 1 already invited.",
      error: "The email to 2 candidates failed. Use Resend on their rows.",
      failedToSend: ["x@example.com", "y@example.com"],
    });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.type(emailsBox(), "a@example.com");
    await user.click(send());
    expect(await screen.findByText("Invited 1 candidate. Skipped 1 already invited.")).toBeVisible();
    expect(screen.getByText("The email to 2 candidates failed. Use Resend on their rows.")).toBeVisible();
    expect(screen.getByText("Not delivered: x@example.com, y@example.com")).toBeVisible();
  });

  it("uses the max it is given", () => {
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={50} />);
    expect(screen.getByText(/Up to 50 candidates per batch/)).toBeVisible();
  });
});

describe("InviteRowActions", () => {
  it("renders nothing when the invite can't be resent or revoked", () => {
    const { container } = render(<InviteRowActions orgId="o" inviteId="i" email="a@b.co" canResend={false} canRevoke={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the actions allowed", () => {
    render(<InviteRowActions orgId="o" inviteId="i" email="a@b.co" canResend={false} canRevoke />);
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("asks before resending and does nothing if cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<InviteRowActions orgId="o" inviteId="i" email="jane@example.com" canResend canRevoke />);
    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(confirm).toHaveBeenCalledWith("Send jane@example.com a new link? Their current link will stop working.");
    expect(resendInviteAction).not.toHaveBeenCalled();
  });

  it("resends after confirming and shows the result", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const pending = deferred<{ message: string }>();
    resendInviteAction.mockReturnValueOnce(pending.promise);
    render(<InviteRowActions orgId="o" inviteId="inv-9" email="jane@example.com" canResend canRevoke />);
    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(formDataOf(resendInviteAction)).toEqual({ orgId: "o", inviteId: "inv-9" });
    await act(async () => pending.resolve({ message: "New link sent." }));
    expect(await screen.findByText("New link sent.")).toBeVisible();
  });

  it("shows a resend error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    resendInviteAction.mockResolvedValueOnce({ error: "That invite can't be resent." });
    render(<InviteRowActions orgId="o" inviteId="i" email="a@b.co" canResend canRevoke={false} />);
    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(await screen.findByText("That invite can't be resent.")).toBeVisible();
  });

  it("asks before revoking, then revokes and shows an error if it fails", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const pending = deferred<{ error: string }>();
    revokeInviteAction.mockReturnValueOnce(pending.promise);
    render(<InviteRowActions orgId="o" inviteId="inv-9" email="jane@example.com" canResend={false} canRevoke />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(confirm).toHaveBeenCalledWith("Revoke jane@example.com's invite? Their link will stop working.");
    expect(await screen.findByRole("button", { name: "Revoking…" })).toBeDisabled();
    expect(formDataOf(revokeInviteAction)).toEqual({ orgId: "o", inviteId: "inv-9" });
    await act(async () => pending.resolve({ error: "Already submitted." }));
    expect(await screen.findByText("Already submitted.")).toBeVisible();
  });

  it("keeps the revoke confirmation visible after the row loses its actions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    revokeInviteAction.mockResolvedValueOnce({ message: "Revoked jane@example.com's invite." });
    const { rerender } = render(<InviteRowActions orgId="o" inviteId="i" email="jane@example.com" canResend canRevoke />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    // The page re-renders the row as revoked: nothing left to resend or revoke.
    rerender(<InviteRowActions orgId="o" inviteId="i" email="jane@example.com" canResend={false} canRevoke={false} />);
    expect(await screen.findByText("Revoked jane@example.com's invite.")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("doesn't revoke if cancelled", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<InviteRowActions orgId="o" inviteId="i" email="a@b.co" canResend={false} canRevoke />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revokeInviteAction).not.toHaveBeenCalled();
  });
});
