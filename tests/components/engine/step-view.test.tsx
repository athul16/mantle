/** The client StepView: looks up a step type's component, or says it can't show it. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepView } from "@/lib/engine/client/StepView";
import { clientStepTypes, hasStepComponent } from "@/lib/engine/client/registry";
import type { PublicStep } from "@/lib/engine/types";

const numeric: PublicStep = { id: "s1", type: "numeric", title: "Shortage", config: { prompt: "How much is missing?", decimals: 2 } };
const reply: PublicStep = { id: "s2", type: "inbox_reply", title: "Reply", config: { prompt: "Answer the client.", maxChars: 500 } };
const sheet: PublicStep = {
  id: "s3",
  type: "spreadsheet",
  title: "Rec",
  config: { prompt: "Fill it in.", columns: ["Item", "Amount"], rows: [[{ kind: "text", text: "Fee" }, { kind: "input", id: "fee", format: "money" }]] },
};

describe("StepView", () => {
  it("registers every built step type", () => {
    expect(Object.keys(clientStepTypes).sort()).toEqual(["document_review", "inbox_reply", "journal_entry", "numeric", "spreadsheet"]);
    expect(hasStepComponent("numeric")).toBe(true);
    expect(hasStepComponent("multiple_choice")).toBe(false);
  });

  it("renders a numeric step and passes its answer up", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StepView step={numeric} onChange={onChange} />);
    await user.type(screen.getByRole("textbox", { name: "How much is missing?" }), "7.5");
    expect(onChange).toHaveBeenLastCalledWith({ value: 7.5 });
  });

  it("renders an inbox reply step with its answer", () => {
    render(<StepView step={reply} answer={{ body: "Hello" }} onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Hello");
  });

  it("renders a spreadsheet step", () => {
    render(<StepView step={sheet} onChange={() => {}} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Fee, Amount" })).toBeInTheDocument();
  });

  it("passes disabled through", () => {
    render(<StepView step={numeric} onChange={() => {}} disabled />);
    expect(screen.getByRole("textbox", { name: "How much is missing?" })).toBeDisabled();
  });

  it("explains when a step type has no browser component", () => {
    render(<StepView step={{ id: "x", type: "multiple_choice", title: "MC", config: {} }} onChange={() => {}} />);
    expect(screen.getByText("This task type (multiple_choice) can't be shown. Please contact support.")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
