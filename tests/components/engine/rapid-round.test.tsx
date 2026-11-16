/** `rapid_round` step view: one item at a time, choices or a number, submitted at once. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RapidRoundStep } from "@/lib/engine/step-types/rapid_round/client";
import type { RapidRoundPublicConfig } from "@/lib/engine/step-types/rapid_round/public";

const endsAt = new Date(Date.now() + 18_000).toISOString();
const config: RapidRoundPublicConfig = {
  intro: "Pick the accounts.",
  itemCount: 4,
  secondsPerItem: 20,
  current: {
    index: 1,
    count: 4,
    endsAt,
    item: {
      id: "je2",
      prompt: "Bought supplies on credit.",
      exhibit: { title: "Bill", rows: [{ label: "Vendor", value: "Acme" }] },
      fields: [
        { id: "debit", label: "Debit", kind: "choice", options: [{ id: "supplies", label: "Supplies" }, { id: "ap", label: "Accounts payable" }] },
        { id: "credit", label: "Credit", kind: "choice", options: [{ id: "supplies", label: "Supplies" }, { id: "ap", label: "Accounts payable" }] },
      ],
    },
  },
};

describe("RapidRoundStep", () => {
  it("shows the item number, prompt, exhibit and a countdown", () => {
    render(<RapidRoundStep config={config} onChange={() => {}} />);
    expect(screen.getByText("Item 2 of 4")).toBeVisible();
    expect(screen.getByText("Bought supplies on credit.")).toBeVisible();
    expect(screen.getByText("Acme")).toBeVisible();
    expect(screen.getByRole("timer")).toHaveTextContent(/0:1\d/);
  });

  it("submits the chosen values for this item in one go", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<RapidRoundStep config={config} onChange={() => {}} onCommit={onCommit} />);
    const submit = screen.getByRole("button", { name: "Submit answer" });
    expect(submit).toBeDisabled();
    // Two radio groups (Debit, Credit) share option labels; first group is Debit.
    expect(screen.getByRole("radiogroup", { name: "Debit" })).toBeVisible();
    await user.click(screen.getAllByRole("radio", { name: "Supplies" })[0]);
    await user.click(screen.getAllByRole("radio", { name: "Accounts payable" })[1]);
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onCommit).toHaveBeenCalledWith({ index: 1, values: { debit: "supplies", credit: "ap" } });
  });

  it("number items take a typed amount", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    const numberConfig: RapidRoundPublicConfig = {
      ...config,
      current: { ...config.current!, item: { id: "n", prompt: "Monthly amount?", fields: [{ id: "value", label: "Amount", kind: "number", unit: "$", decimals: 2 }] } },
    };
    render(<RapidRoundStep config={numberConfig} onChange={() => {}} onCommit={onCommit} />);
    await user.type(screen.getByRole("textbox", { name: "Amount" }), "1,250.50");
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(onCommit).toHaveBeenCalledWith({ index: 1, values: { value: 1250.5 } });
  });

  it("without a current item it explains the round", () => {
    render(<RapidRoundStep config={{ intro: "Pick the accounts.", itemCount: 4, secondsPerItem: 20 }} onChange={() => {}} />);
    expect(screen.getByText(/4 quick items, 20 seconds each/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
  });
});
