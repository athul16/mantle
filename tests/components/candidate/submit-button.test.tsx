/** SubmitButton: candidate form posts show a disabled pending state until the next page loads. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SubmitButton } from "@/app/a/[token]/submit-button";

function renderInForm() {
  render(
    <form action="/api/candidate/code" method="post" aria-label="code">
      <SubmitButton pendingText="Sending code…">Continue</SubmitButton>
    </form>,
  );
  return screen.getByRole("form", { name: "code" });
}

describe("SubmitButton", () => {
  it("is an enabled submit button before the form posts", () => {
    renderInForm();
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "submit");
  });

  it("disables itself and shows the pending text once its form submits", () => {
    const form = renderInForm();
    fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "Sending code…" })).toBeDisabled();
  });

  it("stays idle when the submit was cancelled", () => {
    const form = renderInForm();
    form.addEventListener("submit", (e) => e.preventDefault(), { capture: true });
    fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("re-enables when the page comes back from the back/forward cache", () => {
    const form = renderInForm();
    fireEvent.submit(form);
    act(() => {
      const e = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(e, "persisted", { value: true });
      window.dispatchEvent(e);
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("only reacts to its own form", () => {
    render(
      <>
        <form aria-label="one">
          <SubmitButton pendingText="Verifying…">Verify and continue</SubmitButton>
        </form>
        <form aria-label="two">
          <SubmitButton pendingText="Sending…">Send a new code</SubmitButton>
        </form>
      </>,
    );
    fireEvent.submit(screen.getByRole("form", { name: "two" }));
    expect(screen.getByRole("button", { name: "Verify and continue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  });
});
