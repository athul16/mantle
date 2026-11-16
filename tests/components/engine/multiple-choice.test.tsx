/** `multiple_choice` step view: a group of radios (single) or checkboxes (multi) under the prompt. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StepView } from "@/lib/engine/client/StepView";
import { MultipleChoiceStep } from "@/lib/engine/step-types/multiple_choice/client";
import type { MultipleChoiceAnswer, MultipleChoicePublicConfig } from "@/lib/engine/step-types/multiple_choice/public";

const options = [
  { id: "cash", label: "Cash" },
  { id: "ar", label: "Accounts receivable" },
  { id: "ap", label: "Accounts payable" },
];
const single: MultipleChoicePublicConfig = { prompt: "Which account is debited?", options, select: "single" };
const multi: MultipleChoicePublicConfig = { prompt: "Which of these are assets?", options, select: "multi" };

function Harness({
  config,
  initial,
  onChange,
  disabled,
}: {
  config: MultipleChoicePublicConfig;
  initial?: MultipleChoiceAnswer;
  onChange?: (a: MultipleChoiceAnswer) => void;
  disabled?: boolean;
}) {
  const [answer, setAnswer] = useState(initial);
  return (
    <MultipleChoiceStep
      config={config}
      answer={answer}
      disabled={disabled}
      onChange={(a) => {
        setAnswer(a);
        onChange?.(a);
      }}
    />
  );
}

describe("MultipleChoiceStep, single select", () => {
  it("is a radio group named by the prompt, nothing picked at first", () => {
    render(<Harness config={single} />);
    const group = screen.getByRole("radiogroup", { name: "Which account is debited?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["cash", "ar", "ap"]);
    for (const r of radios) expect(r).not.toBeChecked();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Choose one.")).toBeVisible();
  });

  it("emits the one picked option, replacing the previous pick", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness config={single} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: ["cash"] });
    await user.click(screen.getByRole("radio", { name: "Accounts payable" }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: ["ap"] });
    expect(screen.getByRole("radio", { name: "Cash" })).not.toBeChecked();
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness config={single} onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "Cash" })).toHaveFocus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith({ selected: ["cash"] });
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith({ selected: ["ar"] });
  });

  it("restores a saved answer", () => {
    render(<Harness config={single} initial={{ selected: ["ar"] }} />);
    expect(screen.getByRole("radio", { name: "Accounts receivable" })).toBeChecked();
  });
});

describe("MultipleChoiceStep, multi select", () => {
  it("is a group of checkboxes named by the prompt", () => {
    render(<Harness config={multi} />);
    const group = screen.getByRole("group", { name: "Which of these are assets?" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Choose all that apply.")).toBeVisible();
  });

  it("adds and removes picks, keeping the options' order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness config={multi} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Accounts receivable" }));
    await user.click(screen.getByRole("checkbox", { name: "Cash" }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: ["cash", "ar"] });
    await user.click(screen.getByRole("checkbox", { name: "Accounts receivable" }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: ["cash"] });
  });

  it("restores a saved answer", () => {
    render(<Harness config={multi} initial={{ selected: ["cash", "ap"] }} />);
    expect(screen.getByRole("checkbox", { name: "Cash" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Accounts receivable" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Accounts payable" })).toBeChecked();
  });
});

it("disables every option when disabled", () => {
  render(<Harness config={multi} disabled initial={{ selected: ["cash"] }} />);
  for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
});

it("renders through StepView by type", () => {
  render(<StepView step={{ id: "q1", type: "multiple_choice", title: "Quick check", config: single }} onChange={() => {}} />);
  expect(screen.getByRole("radiogroup", { name: "Which account is debited?" })).toBeVisible();
});
