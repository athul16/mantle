/** /auth/callback: reads the invite session from the URL fragment and stores it. Supabase client mocked. */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { setSession } }) }));

const { default: AuthCallbackPage } = await import("@/app/auth/callback/page");

const EXPIRED = "This link is invalid or has expired. Ask your admin to invite you again.";
const setHash = (hash: string) => window.history.replaceState(null, "", `/auth/callback${hash}`);

beforeEach(() => {
  setSession.mockReset();
  // jsdom can't navigate; location.replace just reports "not implemented".
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  setHash("");
  vi.restoreAllMocks();
});

describe("AuthCallbackPage", () => {
  it("shows a signing-in message while it works", () => {
    setHash("#access_token=a&refresh_token=r&type=invite");
    setSession.mockReturnValue(new Promise(() => {}));
    render(<AuthCallbackPage />);
    expect(screen.getByRole("heading", { name: "Signing you in…" })).toBeVisible();
    expect(screen.getByText("One moment.")).toBeVisible();
  });

  it("stores the session from the fragment", async () => {
    setHash("#access_token=acc&refresh_token=ref&type=invite");
    setSession.mockResolvedValue({ error: null });
    render(<AuthCallbackPage />);
    await vi.waitFor(() => expect(setSession).toHaveBeenCalledWith({ access_token: "acc", refresh_token: "ref" }));
    expect(screen.getByRole("heading", { name: "Signing you in…" })).toBeVisible();
  });

  it("shows the provider's error from the fragment", async () => {
    setHash("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired");
    render(<AuthCallbackPage />);
    expect(await screen.findByRole("heading", { name: "Link problem" })).toBeVisible();
    expect(screen.getByText("Email link is invalid or has expired")).toBeVisible();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("explains an expired link when tokens are missing", async () => {
    setHash("");
    render(<AuthCallbackPage />);
    expect(await screen.findByText(EXPIRED)).toBeVisible();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("explains an expired link when the session is rejected", async () => {
    setHash("#access_token=a&refresh_token=r&type=invite");
    setSession.mockResolvedValue({ error: new Error("invalid JWT") });
    render(<AuthCallbackPage />);
    expect(await screen.findByRole("heading", { name: "Link problem" })).toBeVisible();
    expect(screen.getByText(EXPIRED)).toBeVisible();
  });
});
