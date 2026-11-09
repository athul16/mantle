/** Smoke test for the components project (jsdom + Testing Library + jest-dom). */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, Field, FormMessage } from "@/components/ui";

describe("ui primitives", () => {
  it("Field labels its input and shows an error", () => {
    render(<Field label="Work email" name="email" type="email" error="Enter a valid email." />);
    // The error sits inside the <label>, so it is part of the input's accessible name.
    expect(screen.getByRole("textbox", { name: /^Work email/ })).toHaveAttribute("name", "email");
    expect(screen.getByText("Enter a valid email.")).toBeVisible();
  });

  it("Button clicks unless disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button onClick={onClick} disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("FormMessage renders nothing without a message", () => {
    const { container } = render(<FormMessage />);
    expect(container).toBeEmptyDOMElement();
  });
});
