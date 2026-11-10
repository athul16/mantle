/** Shared UI primitives in src/components/ui.tsx. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthCard, Button, Field, FormMessage } from "@/components/ui";

describe("Field", () => {
  it("labels its input by the label text alone", () => {
    render(<Field label="Work email" name="email" type="email" />);
    const input = screen.getByRole("textbox", { name: "Work email" });
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the error out of the accessible name and links it as the description", () => {
    render(<Field label="Work email" name="email" type="email" error="Enter a valid email." />);
    const input = screen.getByRole("textbox", { name: "Work email" });
    expect(input).toHaveAccessibleName("Work email");
    expect(input).toHaveAccessibleDescription("Enter a valid email.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a valid email.")).toBeVisible();
    expect(screen.getByText("Enter a valid email.").closest("label")).toBeNull();
  });

  it("gives each field its own error id", () => {
    render(
      <>
        <Field label="Password" name="password" type="password" error="Too short." />
        <Field label="Confirm password" name="confirm" type="password" error="Doesn't match." />
      </>,
    );
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Too short.");
    expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription("Doesn't match.");
  });

  it("keeps a caller's aria-describedby alongside the error", () => {
    render(
      <>
        <p id="hint">At least 8 characters.</p>
        <Field label="Password" name="password" type="password" aria-describedby="hint" error="Too short." />
      </>,
    );
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("At least 8 characters. Too short.");
  });

  it("passes input props through and accepts typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field label="Company name" name="name" required placeholder="Acme" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Company name" });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("placeholder", "Acme");
    await user.type(input, "Harbor Lane");
    expect(input).toHaveValue("Harbor Lane");
    expect(onChange).toHaveBeenCalledTimes("Harbor Lane".length);
  });

  it("can be disabled", () => {
    render(<Field label="Email" name="email" disabled />);
    expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
  });
});

describe("Button", () => {
  it("clicks unless disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("submits its form when type=submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Send</Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each(["primary", "secondary", "danger"] as const)("renders the %s variant as a button", (variant) => {
    render(<Button variant={variant}>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toBeEnabled();
  });

  it("keeps a caller's className", () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole("button", { name: "Wide" })).toHaveClass("w-full");
  });
});

describe("FormMessage", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<FormMessage />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a message", () => {
    render(<FormMessage message="Saved." />);
    expect(screen.getByText("Saved.")).toBeVisible();
  });

  it("shows only the error when both are set", () => {
    render(<FormMessage error="Something went wrong." message="Saved." />);
    expect(screen.getByText("Something went wrong.")).toBeVisible();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });
});

describe("AuthCard", () => {
  it("renders a main landmark with a heading, content and footer", () => {
    render(
      <AuthCard title="Sign in" footer={<a href="/signup">Create an account</a>}>
        <p>Body</p>
      </AuthCard>,
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    expect(screen.getByText("Body")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
  });

  it("omits the footer when there is none", () => {
    render(<AuthCard title="Sign in">x</AuthCard>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
