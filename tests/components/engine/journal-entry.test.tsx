/** `journal_entry` step view: entries of account / debit / credit lines with a balance check. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JournalEntryStep } from "@/lib/engine/step-types/journal_entry/client";
import type { JournalEntryAnswer, JournalEntryPublicConfig } from "@/lib/engine/step-types/journal_entry/public";

const config: JournalEntryPublicConfig = {
  prompt: "Draft the entries from Dana's email.",
  accounts: [
    { code: "1010", name: "Cash" },
    { code: "1200", name: "Accounts Receivable" },
    { code: "6200", name: "Bank Service Charges" },
  ],
  maxEntries: 2,
  maxLines: 3,
};

function Harness({
  initial,
  onChange,
  disabled,
  cfg = config,
}: {
  initial?: JournalEntryAnswer;
  onChange?: (a: JournalEntryAnswer) => void;
  disabled?: boolean;
  cfg?: JournalEntryPublicConfig;
}) {
  const [answer, setAnswer] = useState(initial);
  return (
    <JournalEntryStep
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

const account = (entry: number, line: number) => screen.getByRole("combobox", { name: `Account, entry ${entry}, line ${line}` });
const debit = (entry: number, line: number) => screen.getByRole("textbox", { name: `Debit, entry ${entry}, line ${line}` });
const credit = (entry: number, line: number) => screen.getByRole("textbox", { name: `Credit, entry ${entry}, line ${line}` });
const entryBox = (n: number) => screen.getByRole("group", { name: `Entry ${n}` });

describe("JournalEntryStep", () => {
  it("starts with one entry of two blank lines and lists the chart of accounts", () => {
    render(<Harness />);
    expect(screen.getByText(config.prompt)).toBeVisible();
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    const options = within(account(1, 1)).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose account…", "1010 Cash", "1200 Accounts Receivable", "6200 Bank Service Charges"]);
    expect(within(entryBox(1)).getByRole("status")).toHaveTextContent("No amounts yet.");
  });

  it("emits every line with parsed amounts as the candidate types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.selectOptions(account(1, 1), "6200");
    await user.type(debit(1, 1), "$35.00");
    await user.selectOptions(account(1, 2), "1010");
    await user.type(credit(1, 2), "35");
    expect(onChange).toHaveBeenLastCalledWith({
      entries: [
        {
          memo: "",
          lines: [
            { account: "6200", debit: 35, credit: null },
            { account: "1010", debit: null, credit: 35 },
          ],
        },
      ],
    });
  });

  it("shows totals and whether the entry balances", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(debit(1, 1), "1,200.50");
    const status = within(entryBox(1)).getByRole("status");
    expect(status).toHaveTextContent("Out of balance by 1,200.50.");
    await user.type(credit(1, 2), "1200");
    expect(status).toHaveTextContent("Out of balance by 0.50.");
    await user.type(credit(1, 2), ".5");
    expect(status).toHaveTextContent("Balanced.");
    const totals = within(entryBox(1)).getByRole("row", { name: /Total/ });
    expect(within(totals).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1,200.50", "1,200.50", ""]);
  });

  it("keeps junk text on screen but saves null for it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(debit(1, 1), "abc");
    expect(debit(1, 1)).toHaveValue("abc");
    expect(onChange.mock.lastCall?.[0].entries[0].lines[0]).toEqual({ account: "", debit: null, credit: null });
  });

  it("adds and removes lines within the limits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const removeFirst = screen.getByRole("button", { name: "Remove entry 1, line 1" });
    expect(removeFirst).toBeDisabled(); // an entry keeps at least two lines
    const add = screen.getByRole("button", { name: "Add line to entry 1" });
    await user.click(add);
    expect(add).toBeDisabled(); // maxLines = 3
    await user.type(debit(1, 3), "9");
    await user.click(screen.getByRole("button", { name: "Remove entry 1, line 1" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(debit(1, 2)).toHaveValue("9");
    expect(onChange.mock.lastCall?.[0].entries[0].lines).toHaveLength(2);
  });

  it("adds and deletes entries within the limits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Delete entry 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add entry" }));
    expect(screen.getByRole("button", { name: "Add entry" })).toBeDisabled(); // maxEntries = 2
    await user.type(debit(2, 1), "480");
    await user.click(screen.getByRole("button", { name: "Delete entry 1" }));
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(debit(1, 1)).toHaveValue("480");
    expect(onChange.mock.lastCall?.[0].entries).toHaveLength(1);
  });

  it("saves the description", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole("textbox", { name: "Description (optional)" }), "NSF");
    expect(onChange.mock.lastCall?.[0].entries[0].memo).toBe("NSF");
  });

  it("restores a saved answer", () => {
    render(
      <Harness
        initial={{
          entries: [
            { memo: "fee", lines: [{ account: "6200", debit: 35, credit: null }, { account: "1010", debit: null, credit: 35 }] },
            { memo: "", lines: [{ account: "", debit: null, credit: null }, { account: "", debit: null, credit: null }] },
          ],
        }}
      />,
    );
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(account(1, 1)).toHaveValue("6200");
    expect(debit(1, 1)).toHaveValue("35");
    expect(credit(1, 2)).toHaveValue("35");
    expect(within(entryBox(1)).getByRole("status")).toHaveTextContent("Balanced.");
    expect(screen.getByDisplayValue("fee")).toBeVisible();
  });

  it("disables every control when disabled", () => {
    render(<Harness disabled />);
    for (const el of [...screen.getAllByRole("combobox"), ...screen.getAllByRole("textbox"), ...screen.getAllByRole("button")]) {
      expect(el).toBeDisabled();
    }
  });
});
