/** `numeric` step view: one number input under a prompt. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NumericStep } from "@/lib/engine/step-types/numeric/client";
import type { NumericPublicConfig } from "@/lib/engine/step-types/numeric/public";

const config: NumericPublicConfig = { prompt: "What is the adjusted cash balance?", unit: "$", decimals: 2 };

function setup(props: Partial<Parameters<typeof NumericStep>[0]> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<NumericStep config={config} onChange={onChange} {...props} />);
  const input = screen.getByRole("textbox", { name: config.prompt });
  const last = () => onChange.mock.lastCall?.[0];
  return { user, input, onChange, last };
}

describe("NumericStep", () => {
  it("labels the input with the prompt and shows the unit and a placeholder by decimals", () => {
    const { input } = setup();
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "0.00");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("$")).toBeVisible();
  });

  it("uses a whole-number placeholder and no unit when the config has none", () => {
    render(<NumericStep config={{ prompt: "How many tablets?", decimals: 0 }} onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "How many tablets?" })).toHaveAttribute("placeholder", "0");
    expect(screen.queryByText("$")).not.toBeInTheDocument();
  });

  it.each([
    ["1234.5", 1234.5],
    ["1,234.50", 1234.5],
    ["$ 1,234.50", 1234.5],
    ["-42", -42],
    ["0", 0],
    ["12.", 12],
  ])("parses %j as %s", async (typed, value) => {
    const { user, input, last } = setup();
    await user.type(input, typed);
    expect(input).toHaveValue(typed);
    expect(last()).toEqual({ value });
  });

  it.each(["abc", "-", "1.2.3", "(100)"])("keeps %j on screen but saves null", async (typed) => {
    const { user, input, last } = setup();
    await user.type(input, typed);
    expect(input).toHaveValue(typed);
    expect(last()).toEqual({ value: null });
  });

  it("saves null when the field is cleared", async () => {
    const { user, input, last } = setup();
    await user.type(input, "15");
    await user.clear(input);
    expect(last()).toEqual({ value: null });
  });

  it("starts from a saved answer", () => {
    const { input } = setup({ answer: { value: 1520.75 } });
    expect(input).toHaveValue("1520.75");
  });

  it("starts empty from a saved null", () => {
    const { input } = setup({ answer: { value: null } });
    expect(input).toHaveValue("");
  });

  it("can't be typed in when disabled", async () => {
    const { user, input, onChange } = setup({ disabled: true });
    expect(input).toBeDisabled();
    await user.type(input, "5");
    expect(onChange).not.toHaveBeenCalled();
  });
});
