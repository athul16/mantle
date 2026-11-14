/** `inbox_reply` step view: an email reply editor. */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { InboxReplyStep } from "@/lib/engine/step-types/inbox_reply/client";
import type { InboxReplyAnswer, InboxReplyPublicConfig } from "@/lib/engine/step-types/inbox_reply/public";

const config: InboxReplyPublicConfig = {
  prompt: "Reply to Marcus and explain the difference.",
  to: "Marcus Lee <marcus@harborlane.example>",
  subject: "Re: Where did my money go?",
  maxChars: 2000,
};

/** Holds the answer like the workspace does, so the editor is controlled. */
function Harness({ cfg = config, initial, onChange, disabled }: { cfg?: InboxReplyPublicConfig; initial?: InboxReplyAnswer; onChange?: (a: InboxReplyAnswer) => void; disabled?: boolean }) {
  const [answer, setAnswer] = useState(initial);
  return (
    <InboxReplyStep
      config={cfg}
      answer={answer}
      disabled={disabled}
      onChange={(a) => {
        setAnswer(a);
        onChange?.(a);
      }}
    />
  );
}

const counter = () => screen.getByText(/words ·/);

describe("InboxReplyStep", () => {
  it("shows the recipient and subject, and leaves the prompt to the page", () => {
    render(<Harness />);
    // The workspace shows the prompt in its brief column (stepBrief).
    expect(screen.queryByText(config.prompt)).not.toBeInTheDocument();
    expect(screen.getByText("To")).toBeVisible();
    expect(screen.getByText(config.to!)).toBeVisible();
    expect(screen.getByText("Subject")).toBeVisible();
    expect(screen.getByText(config.subject!)).toBeVisible();
  });

  it("leaves out the header when there is no recipient or subject", () => {
    render(<Harness cfg={{ prompt: "Write a note.", maxChars: 500 }} />);
    expect(screen.queryByText("To")).not.toBeInTheDocument();
    expect(screen.queryByText("Subject")).not.toBeInTheDocument();
  });

  it("shows only the recipient when there is no subject", () => {
    render(<Harness cfg={{ prompt: "p", to: "ops@example.com", maxChars: 500 }} />);
    expect(screen.getByText("ops@example.com")).toBeVisible();
    expect(screen.queryByText("Subject")).not.toBeInTheDocument();
  });

  it("has a labelled reply box with a placeholder and the character limit", () => {
    render(<Harness />);
    const box = screen.getByRole("textbox", { name: "Reply" });
    expect(box).toHaveAttribute("placeholder", "Write your reply");
    expect(box).toHaveAttribute("maxlength", "2000");
    expect(counter()).toHaveTextContent("0 words · 0 / 2,000 characters");
  });

  it("counts words and characters as the candidate types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Reply" });
    await user.type(box, "Hi Marcus,{enter}{enter}the  difference is timing.");
    expect(onChange).toHaveBeenLastCalledWith({ body: "Hi Marcus,\n\nthe  difference is timing." });
    expect(counter()).toHaveTextContent("6 words · 38 / 2,000 characters");
  });

  it("counts whitespace-only text as zero words", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("textbox", { name: "Reply" }), "   ");
    expect(counter()).toHaveTextContent("0 words · 3 / 2,000 characters");
  });

  it("formats large counts with thousands separators", () => {
    render(<Harness cfg={{ ...config, maxChars: 20_000 }} initial={{ body: "a".repeat(1234) }} />);
    expect(counter()).toHaveTextContent("1 words · 1,234 / 20,000 characters");
  });

  it("cuts a paste that is over the limit to the limit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness cfg={{ ...config, maxChars: 10 }} onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Reply" });
    await user.click(box);
    await user.paste("one two three four");
    expect((box as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(10);
    expect(onChange.mock.lastCall?.[0].body.length).toBeLessThanOrEqual(10);
  });

  it("cuts an over-long change even if the browser ignores maxlength", () => {
    const onChange = vi.fn();
    render(<Harness cfg={{ ...config, maxChars: 5 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), { target: { value: "abcdefgh" } });
    expect(onChange).toHaveBeenLastCalledWith({ body: "abcde" });
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("abcde");
  });

  it("starts from a saved answer", () => {
    render(<Harness initial={{ body: "Draft so far" }} />);
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Draft so far");
    expect(counter()).toHaveTextContent("3 words · 12 / 2,000 characters");
  });

  it("can't be typed in when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Reply" });
    expect(box).toBeDisabled();
    await user.type(box, "x");
    expect(onChange).not.toHaveBeenCalled();
  });
});
