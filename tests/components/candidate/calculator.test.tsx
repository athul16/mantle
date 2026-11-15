/** The workspace's built-in calculator: arithmetic without eval, and its keypad. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Calculator, evaluate } from "@/app/a/[token]/workspace/calculator";

describe("evaluate", () => {
  it("does + − × ÷ with the usual precedence", () => {
    expect(evaluate("21120+1050-3200")).toBe(18970);
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("10/4")).toBe(2.5);
    expect(evaluate("-5+2")).toBe(-3);
  });

  it("ignores a trailing operator and anything that isn't a number or operator", () => {
    expect(evaluate("7+")).toBe(7);
    expect(evaluate("alert(1)")).toBe(1);
    expect(evaluate("")).toBe(0);
  });
});

describe("Calculator", () => {
  const key = (name: string) => screen.getByRole("button", { name });

  it("shows the expression as it's typed and the result on =", async () => {
    const user = userEvent.setup();
    render(<Calculator onClose={() => {}} />);
    for (const k of ["7", "+", "5", "×", "2"]) await user.click(key(k));
    expect(screen.getByTestId("calc-output")).toHaveTextContent("7+5×2");
    await user.click(key("="));
    expect(screen.getByTestId("calc-output")).toHaveTextContent("17");
    expect(screen.getByText("7+5×2 =")).toBeVisible();
  });

  it("deletes, clears and reports division by zero", async () => {
    const user = userEvent.setup();
    render(<Calculator onClose={() => {}} />);
    for (const k of ["1", "2"]) await user.click(key(k));
    await user.click(key("Delete"));
    expect(screen.getByTestId("calc-output")).toHaveTextContent("1");
    for (const k of ["÷", "0", "="]) await user.click(key(k));
    expect(screen.getByTestId("calc-output")).toHaveTextContent("Error");
    await user.click(key("C"));
    expect(screen.getByTestId("calc-output")).toHaveTextContent("0");
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<Calculator onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close calculator" }));
    expect(onClose).toHaveBeenCalled();
  });
});
