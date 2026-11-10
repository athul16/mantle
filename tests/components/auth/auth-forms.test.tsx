/** Sign-in/sign-up form, create-company form and set-password page. Server actions mocked. */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/components/ui";
import { deferred, formDataOf } from "../helpers";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("@/app/onboarding/actions", () => ({ createOrganization: vi.fn() }));
vi.mock("@/app/auth/set-password/actions", () => ({ setPassword: vi.fn() }));

const { CredentialsForm } = await import("@/app/(auth)/credentials-form");
const { CreateOrgForm } = await import("@/app/onboarding/create-org-form");
const { default: SetPasswordPage } = await import("@/app/auth/set-password/page");
const createOrganization = vi.mocked((await import("@/app/onboarding/actions")).createOrganization);
const setPassword = vi.mocked((await import("@/app/auth/set-password/actions")).setPassword);

beforeEach(() => {
  vi.clearAllMocks();
  search = new URLSearchParams();
});

describe("CredentialsForm", () => {
  const renderForm = (action = vi.fn<(s: FormState, f: FormData) => Promise<FormState>>()) => {
    render(<CredentialsForm action={action} submitLabel="Sign in" passwordAutoComplete="current-password" />);
    return action;
  };

  it("has labelled email and password fields with the right autocomplete", () => {
    renderForm();
    const email = screen.getByRole("textbox", { name: "Work email" });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toBeRequired();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("minlength", "8");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("sends the credentials and the ?next= page, and shows Please wait… meanwhile", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("next=/app/harbor-lane/jobs");
    const pending = deferred<FormState>();
    const action = renderForm(vi.fn(() => pending.promise));
    await user.type(screen.getByRole("textbox", { name: "Work email" }), "dana@harbor.example");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Please wait…" })).toBeDisabled();
    expect(formDataOf(action)).toEqual({ next: "/app/harbor-lane/jobs", email: "dana@harbor.example", password: "correct horse" });
    await act(async () => pending.resolve({ error: "Wrong email or password." }));
    expect(await screen.findByText("Wrong email or password.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("sends an empty next when there is none", async () => {
    const user = userEvent.setup();
    const action = renderForm(vi.fn(async () => undefined));
    await user.type(screen.getByRole("textbox", { name: "Work email" }), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "12345678");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(formDataOf(action).next).toBe("");
  });

  it("shows field errors on the fields and a confirmation message", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn(async () => ({
        fieldErrors: { email: ["Enter a valid email."], password: ["Use at least 8 characters."] },
        message: "Check your email to confirm.",
      })),
    );
    await user.type(screen.getByRole("textbox", { name: "Work email" }), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "12345678");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Work email" })).toHaveAccessibleDescription("Enter a valid email."));
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Use at least 8 characters.");
    expect(screen.getByText("Check your email to confirm.")).toBeVisible();
  });
});

describe("CreateOrgForm", () => {
  it("creates the company and shows Creating… meanwhile", async () => {
    const user = userEvent.setup();
    const pending = deferred<FormState>();
    createOrganization.mockReturnValueOnce(pending.promise);
    render(<CreateOrgForm />);
    const name = screen.getByRole("textbox", { name: "Company name" });
    expect(name).toHaveAttribute("autocomplete", "organization");
    await user.type(name, "Harbor Lane");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(formDataOf(createOrganization)).toEqual({ name: "Harbor Lane" });
    await act(async () => pending.resolve({ error: "Something went wrong." }));
    expect(await screen.findByText("Something went wrong.")).toBeVisible();
  });

  it("shows a name error on the field", async () => {
    const user = userEvent.setup();
    createOrganization.mockResolvedValueOnce({ fieldErrors: { name: ["That name is taken."] } });
    render(<CreateOrgForm />);
    await user.type(screen.getByRole("textbox", { name: "Company name" }), "x");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Company name" })).toHaveAccessibleDescription("That name is taken."));
  });
});

describe("SetPasswordPage", () => {
  it("asks for a new password twice", () => {
    render(<SetPasswordPage />);
    expect(screen.getByRole("heading", { name: "Set your password" })).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "8");
    expect(screen.getByLabelText("Confirm password")).toBeRequired();
  });

  it("saves, shows Saving… meanwhile, and shows a mismatch on the confirm field", async () => {
    const user = userEvent.setup();
    const pending = deferred<FormState>();
    setPassword.mockReturnValueOnce(pending.promise);
    render(<SetPasswordPage />);
    await user.type(screen.getByLabelText("Password"), "longenough1");
    await user.type(screen.getByLabelText("Confirm password"), "longenough2");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(formDataOf(setPassword)).toEqual({ password: "longenough1", confirm: "longenough2" });
    await act(async () => pending.resolve({ fieldErrors: { confirm: ["Passwords don't match."] } }));
    await waitFor(() => expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription("Passwords don't match."));
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a form-level error", async () => {
    const user = userEvent.setup();
    setPassword.mockResolvedValueOnce({ error: "Your invite link expired." });
    render(<SetPasswordPage />);
    await user.type(screen.getByLabelText("Password"), "longenough1");
    await user.type(screen.getByLabelText("Confirm password"), "longenough1");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Your invite link expired.")).toBeVisible();
  });
});
