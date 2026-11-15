/**
 * /auth/confirm: rendering the page (what a link scanner does) never verifies
 * anything; only clicking the button posts the token. Server action mocked.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formDataOf } from "../helpers";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("@/app/auth/confirm/actions", () => ({ confirmLink: vi.fn() }));

const { ConfirmForm } = await import("@/app/auth/confirm/confirm-form");
const { LINK_EXPIRED } = await import("@/app/auth/confirm/messages");
const confirmLink = vi.mocked((await import("@/app/auth/confirm/actions")).confirmLink);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConfirmForm", () => {
  it("shows an Accept button for an invite and verifies nothing on load", () => {
    search = new URLSearchParams("token_hash=abc&type=invite");
    render(<ConfirmForm />);
    expect(screen.getByRole("button", { name: "Accept invite" })).toBeEnabled();
    expect(screen.getByText(/invited to a company account/)).toBeVisible();
    expect(confirmLink).not.toHaveBeenCalled();
  });

  it("posts the token only when the button is clicked", async () => {
    search = new URLSearchParams("token_hash=abc&type=invite");
    confirmLink.mockResolvedValue(undefined);
    render(<ConfirmForm />);
    await userEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    await waitFor(() => expect(confirmLink).toHaveBeenCalledTimes(1));
    expect(formDataOf(confirmLink)).toEqual({ token_hash: "abc", type: "invite" });
  });

  it("shows a Confirm email button for sign-up links, keeping next", async () => {
    search = new URLSearchParams("token_hash=xyz&type=email&next=/onboarding");
    confirmLink.mockResolvedValue(undefined);
    render(<ConfirmForm />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    await waitFor(() => expect(confirmLink).toHaveBeenCalledTimes(1));
    expect(formDataOf(confirmLink)).toEqual({ token_hash: "xyz", type: "email", next: "/onboarding" });
  });

  it("accepts a PKCE code link the same way", async () => {
    search = new URLSearchParams("code=c0de");
    confirmLink.mockResolvedValue(undefined);
    render(<ConfirmForm />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    await waitFor(() => expect(formDataOf(confirmLink)).toEqual({ code: "c0de" }));
  });

  it("shows the server's error when the link is used up", async () => {
    search = new URLSearchParams("token_hash=abc&type=invite");
    confirmLink.mockResolvedValue({ error: LINK_EXPIRED });
    render(<ConfirmForm />);
    await userEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    expect(await screen.findByText(LINK_EXPIRED)).toBeVisible();
  });

  it("explains a link with no token and offers no button", () => {
    search = new URLSearchParams("");
    render(<ConfirmForm />);
    expect(screen.getByText(LINK_EXPIRED)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
