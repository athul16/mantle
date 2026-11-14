/** Invite page client form (emails as chips, or a CSV) and the resend / revoke row actions. */
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

const emailsBox = () => screen.getByRole("textbox", { name: "Email addresses" });
const csvInput = () => screen.getByLabelText("CSV file") as HTMLInputElement;
const send = () => screen.getByRole("button", { name: /^Send( \d+)? invites?$/ });
const counts = () => document.getElementById("invite-counts")!;
const chip = (email: string) => screen.queryByRole("button", { name: `Remove ${email}` });

describe("InviteCandidatesForm", () => {
  it("offers paste and CSV tabs and states the batch limit", async () => {
    const user = userEvent.setup();
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    expect(screen.getByRole("tab", { name: "Paste emails" })).toHaveAttribute("aria-selected", "true");
    expect(emailsBox()).toHaveValue("");
    expect(screen.getByText(/Up to 200 candidates per batch/)).toBeVisible();
    expect(send()).toHaveTextContent("Send invites");
    expect(send()).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "Upload CSV" }));
    expect(screen.getByRole("tab", { name: "Upload CSV" })).toHaveAttribute("aria-selected", "true");
    expect(csvInput()).toHaveAttribute("type", "file");
    expect(csvInput()).toHaveAttribute("accept", ".csv,text/csv,text/plain");
    expect(csvInput()).toBeVisible();
  });

  it("turns pasted emails into chips, sends them and shows Sending invites… while it runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ message: string; invited: string[] }>();
    inviteCandidates.mockReturnValueOnce(pending.promise);
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.click(emailsBox());
    await user.paste("jane@example.com\nsam@example.com, lee@example.com");
    for (const e of ["jane@example.com", "sam@example.com"]) expect(chip(e)).toBeInTheDocument();
    // The last address has no separator after it yet, so it's still being typed (and still counted).
    expect(emailsBox()).toHaveValue("lee@example.com");
    expect(counts()).toHaveTextContent("3 ready");
    expect(send()).toHaveTextContent("Send 3 invites");
    await user.click(send());

    expect(await screen.findByRole("button", { name: "Sending invites…" })).toBeDisabled();
    expect(formDataOf(inviteCandidates)).toMatchObject({ orgId: "org-1", jobId: "job-1", emails: "jane@example.com\nsam@example.com\nlee@example.com" });

    await act(async () => pending.resolve({ message: "Invited 3 candidates.", invited: ["a", "b", "c"] }));
    expect(await screen.findByText("Invited 3 candidates.")).toBeVisible();
    // A successful batch clears the box.
    expect(chip("jane@example.com")).not.toBeInTheDocument();
    expect(emailsBox()).toHaveValue("");
  });

  it("sends what's still being typed, without a separator", async () => {
    const user = userEvent.setup();
    inviteCandidates.mockResolvedValueOnce({ message: "Invited 1 candidate." });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.type(emailsBox(), "solo@example.com");
    expect(send()).toHaveTextContent("Send 1 invite");
    await user.click(send());
    await waitFor(() => expect(formDataOf(inviteCandidates).emails).toBe("solo@example.com"));
  });

  it("marks invalid and already-invited addresses and counts only the ready ones", async () => {
    const user = userEvent.setup();
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} existingEmails={["old@example.com"]} />);
    await user.type(emailsBox(), "OLD@example.com lucas@@example new@example.com new@example.com ");
    expect(counts()).toHaveTextContent("1 ready · 1 to fix · 1 already invited, will be skipped");
    expect(screen.getByText("OLD@example.com · already invited")).toBeVisible();
    expect(screen.getByTitle("Not a valid email address")).toHaveTextContent("lucas@@example");
    // The repeated address became one chip.
    expect(screen.getAllByRole("button", { name: "Remove new@example.com" })).toHaveLength(1);
    expect(send()).toHaveTextContent("Send 1 invite");
    expect(screen.getByText("Fix or remove the invalid address first. Nothing is sent while one is invalid.")).toBeVisible();
  });

  it("removes a chip with its button or Backspace", async () => {
    const user = userEvent.setup();
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.type(emailsBox(), "a@example.com b@example.com{Enter}");
    await user.click(chip("a@example.com")!);
    expect(chip("a@example.com")).not.toBeInTheDocument();
    await user.click(emailsBox());
    await user.keyboard("{Backspace}");
    expect(chip("b@example.com")).not.toBeInTheDocument();
    expect(send()).toHaveTextContent("Send invites");
  });

  it("sends an uploaded CSV file and counts its rows", async () => {
    const user = userEvent.setup();
    inviteCandidates.mockResolvedValueOnce({ message: "Invited 2 candidates." });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} />);
    await user.click(screen.getByRole("tab", { name: "Upload CSV" }));
    const file = new File(["email,name\njane@example.com,Jane\nsam@example.com,Sam\n"], "candidates.csv", { type: "text/csv" });
    await user.upload(csvInput(), file);
    expect(csvInput().files?.[0]).toBe(file);
    expect(await screen.findByText("candidates.csv: 2 ready")).toBeVisible();
    expect(send()).toHaveTextContent("Send 2 invites");
    await user.click(send());
    await waitFor(() => expect(inviteCandidates).toHaveBeenCalledTimes(1));
    // The form sends a "csv" file entry. jsdom builds FormData from its own file
    // list, not the one user-event sets, so the contents arrive empty here; the
    // real upload is covered end to end.
    expect(formDataOf(inviteCandidates).csv).toBeInstanceOf(File);
    expect(await screen.findByText("Invited 2 candidates.")).toBeVisible();
  });

  it("shows the 200 limit message and puts the pasted emails back", async () => {
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
    expect(chip("c0@example.com")).toBeInTheDocument();
    expect(chip("c200@example.com")).toBeInTheDocument();
    expect(counts()).toHaveTextContent("201 ready");
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

  it("shows partial success: the summary, the failure, who wasn't delivered and a link to the candidates", async () => {
    const user = userEvent.setup();
    inviteCandidates.mockResolvedValueOnce({
      message: "Invited 1 candidate. Skipped 1 already invited.",
      error: "The email to 2 candidates failed. Use Resend on their rows.",
      failedToSend: ["x@example.com", "y@example.com"],
    });
    render(<InviteCandidatesForm orgId="org-1" jobId="job-1" max={200} jobHref="/app/acme/jobs/job-1" />);
    await user.type(emailsBox(), "a@example.com");
    await user.click(send());
    expect(await screen.findByText("Invited 1 candidate. Skipped 1 already invited.")).toBeVisible();
    expect(screen.getByText("The email to 2 candidates failed. Use Resend on their rows.")).toBeVisible();
    expect(screen.getByText("Not delivered: x@example.com, y@example.com")).toBeVisible();
    expect(screen.getByRole("link", { name: "View candidates" })).toHaveAttribute("href", "/app/acme/jobs/job-1");
  });

  it("shows the summary card and the email preview", () => {
    render(
      <InviteCandidatesForm
        orgId="org-1"
        jobId="job-1"
        max={50}
        summary={{ assessment: "Bank reconciliation", minutes: 30, deadline: null }}
        emailPreview={{ subject: "Acme: your work simulation for Audit intern", body: "Hi {first name} — Acme has invited you." }}
      />,
    );
    expect(screen.getByText(/Up to 50 candidates per batch/)).toBeVisible();
    expect(screen.getByText("Bank reconciliation")).toBeVisible();
    expect(screen.getByText("30 min")).toBeVisible();
    expect(screen.getByText("0 candidates")).toBeVisible();
    expect(screen.getByText("Acme: your work simulation for Audit intern")).toBeVisible();
    expect(screen.getByText("Hi {first name} — Acme has invited you.")).toBeVisible();
  });
});

describe("InviteRowActions", () => {
  it("renders nothing when the invite can't be resent or revoked", () => {
    const { container } = render(<InviteRowActions orgId="o" inviteId="i" email="a@b.co" canResend={false} canRevoke={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the actions allowed", () => {
    render(<InviteRowActions orgId="o" inviteId="i" email="a@b.co" canResend={false} canRevoke />);
    expect(screen.queryByRole("button", { name: "Resend link" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("asks before resending and does nothing if cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<InviteRowActions orgId="o" inviteId="i" email="jane@example.com" canResend canRevoke />);
    await user.click(screen.getByRole("button", { name: "Resend link" }));
    expect(confirm).toHaveBeenCalledWith("Send jane@example.com a new link? Their current link will stop working.");
    expect(resendInviteAction).not.toHaveBeenCalled();
  });

  it("resends after confirming and shows the result", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const pending = deferred<{ message: string }>();
    resendInviteAction.mockReturnValueOnce(pending.promise);
    render(<InviteRowActions orgId="o" inviteId="inv-9" email="jane@example.com" canResend canRevoke />);
    await user.click(screen.getByRole("button", { name: "Resend link" }));
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
    await user.click(screen.getByRole("button", { name: "Resend link" }));
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
