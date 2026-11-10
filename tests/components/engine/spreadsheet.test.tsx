/** `spreadsheet` step view: read-only cells plus number input cells. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SpreadsheetStep } from "@/lib/engine/step-types/spreadsheet/client";
import type { SpreadsheetAnswer, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

const config: SpreadsheetPublicConfig = {
  prompt: "Complete the bank reconciliation.",
  columns: ["Item", "Amount ($)", "Notes"],
  rows: [
    [{ kind: "text", text: "Balance per bank", bold: true }, { kind: "text", text: "12,400.00", align: "right" }, { kind: "empty" }],
    [{ kind: "text", text: "Add: deposit in transit" }, { kind: "input", id: "dit", format: "money" }, { kind: "input", id: "note_count", format: "number" }],
    [{ kind: "text", text: "Less: outstanding checks" }, { kind: "input", id: "oc_total", format: "money" }, { kind: "empty" }],
    [{ kind: "text", text: "Section break" }, { kind: "text", text: "—" }, { kind: "empty" }],
    [{ kind: "text", text: "Adjusted bank balance", bold: true }, { kind: "input", id: "adj_bank", format: "money" }, { kind: "input", id: "note_last", format: "number" }],
  ],
};

function Harness({ initial, onChange, disabled, cfg = config }: { initial?: SpreadsheetAnswer; onChange?: (a: SpreadsheetAnswer) => void; disabled?: boolean; cfg?: SpreadsheetPublicConfig }) {
  const [answer, setAnswer] = useState(initial);
  return (
    <SpreadsheetStep
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

const cell = (name: string) => screen.getByRole("textbox", { name });
const DIT = "Add: deposit in transit, Amount ($)";
const OC = "Less: outstanding checks, Amount ($)";
const ADJ = "Adjusted bank balance, Amount ($)";

describe("SpreadsheetStep", () => {
  it("renders the prompt, column headers and read-only cells as text", () => {
    render(<Harness />);
    expect(screen.getByText(config.prompt)).toBeVisible();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Item", "Amount ($)", "Notes"]);
    const firstRow = screen.getAllByRole("row")[1];
    expect(within(firstRow).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(firstRow).getByText("12,400.00")).toBeVisible();
    expect(within(firstRow).getByText("Balance per bank")).toBeVisible();
  });

  it("renders one labelled input per input cell, named by row and column", () => {
    render(<Harness />);
    expect(screen.getAllByRole("textbox")).toHaveLength(5);
    expect(cell(DIT)).toHaveAttribute("placeholder", "0.00");
    expect(cell("Add: deposit in transit, Notes")).toHaveAttribute("placeholder", "0");
    expect(cell(ADJ)).toBeEnabled();
  });

  it("falls back to row and column numbers when there is no row label or header", () => {
    render(
      <Harness
        cfg={{ prompt: "p", columns: ["Only"], rows: [[{ kind: "input", id: "a", format: "number" }, { kind: "input", id: "b", format: "number" }]] }}
      />,
    );
    expect(cell("Row 1, Only")).toBeInTheDocument();
    expect(cell("Row 1, column 2")).toBeInTheDocument();
  });

  it.each([
    ["1200", 1200],
    ["1,200.50", 1200.5],
    ["$1,200.50", 1200.5],
    ["$ 1 200", 1200],
    ["-100", -100],
    ["(1,200.00)", -1200],
    ["($75.25)", -75.25],
    [".5", 0.5],
    ["12.", 12],
  ])("parses %j as %s", async (typed, value) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(cell(DIT), typed);
    expect(cell(DIT)).toHaveValue(typed);
    expect(onChange).toHaveBeenLastCalledWith({ cells: { dit: value } });
  });

  it.each(["abc", "(", "1.2.3", "--5", "$"])("keeps %j on screen but saves null", async (typed) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(cell(DIT), typed);
    expect(cell(DIT)).toHaveValue(typed);
    expect(onChange).toHaveBeenLastCalledWith({ cells: { dit: null } });
  });

  it("sends every cell typed so far, and null for a cleared one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(cell(DIT), "500");
    await user.type(cell(OC), "(250)");
    expect(onChange).toHaveBeenLastCalledWith({ cells: { dit: 500, oc_total: -250 } });
    await user.clear(cell(DIT));
    expect(onChange).toHaveBeenLastCalledWith({ cells: { dit: null, oc_total: -250 } });
  });

  it("Enter and ArrowDown move to the next input in the same column, skipping text rows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cell(DIT));
    await user.keyboard("{Enter}");
    expect(cell(OC)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(cell(ADJ)).toHaveFocus();
  });

  it("ArrowUp moves to the previous input in the same column", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cell(ADJ));
    await user.keyboard("{ArrowUp}");
    expect(cell(OC)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(cell(DIT)).toHaveFocus();
  });

  it("stays put at the edges of a column", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cell(DIT));
    await user.keyboard("{ArrowUp}");
    expect(cell(DIT)).toHaveFocus();
    await user.click(cell(ADJ));
    await user.keyboard("{Enter}");
    expect(cell(ADJ)).toHaveFocus();
  });

  it("moves within its own column only", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cell("Add: deposit in transit, Notes"));
    await user.keyboard("{ArrowDown}");
    expect(cell("Adjusted bank balance, Notes")).toHaveFocus();
  });

  it("selects the target cell's text so typing replaces it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ cells: { oc_total: 999 } }} onChange={onChange} />);
    await user.click(cell(DIT));
    await user.keyboard("{Enter}");
    expect(cell(OC)).toHaveFocus();
    await user.keyboard("42");
    expect(cell(OC)).toHaveValue("42");
    expect(onChange).toHaveBeenLastCalledWith({ cells: { oc_total: 42 } });
  });

  it("ignores other keys (left/right arrows don't move between cells)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cell(DIT));
    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(cell(DIT)).toHaveFocus();
  });

  it("round-trips a saved answer back into the grid", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<Harness onChange={onChange} />);
    await user.type(cell(DIT), "1,250.75");
    await user.type(cell(OC), "(300)");
    const saved = onChange.mock.lastCall?.[0] as SpreadsheetAnswer;
    expect(saved).toEqual({ cells: { dit: 1250.75, oc_total: -300 } });
    unmount();

    // What autosave stored comes back as the answer prop.
    render(<Harness initial={JSON.parse(JSON.stringify(saved))} />);
    expect(cell(DIT)).toHaveValue("1250.75");
    expect(cell(OC)).toHaveValue("-300");
    expect(cell(ADJ)).toHaveValue("");
  });

  it("shows a saved null as an empty cell", () => {
    render(<Harness initial={{ cells: { dit: null } }} />);
    expect(cell(DIT)).toHaveValue("");
  });

  it("disables every input cell when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    for (const box of screen.getAllByRole("textbox")) expect(box).toBeDisabled();
    await user.type(cell(DIT), "1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains how to enter negatives", () => {
    render(<Harness />);
    expect(screen.getByText(/negatives as -100 or \(100\)/)).toBeVisible();
  });
});
