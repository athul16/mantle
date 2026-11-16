/** `document_review` step view: flag header fields, lines and totals with a reason; optional decision. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DocumentReviewStep } from "@/lib/engine/step-types/document_review/client";
import type { DocumentReviewAnswer, DocumentReviewPublicConfig } from "@/lib/engine/step-types/document_review/public";

const config: DocumentReviewPublicConfig = {
  prompt: "Check this invoice before it's paid.",
  document: {
    title: "Greenway Mulch & Stone · Invoice",
    fields: [
      { id: "invoice_no", label: "Invoice #", value: "GM-4417" },
      { id: "terms", label: "Terms", value: "Net 30" },
    ],
    columns: ["Description", "Qty", "Unit price", "Amount"],
    rows: [
      { id: "mulch", cells: ["Hardwood mulch", "40", "$12.50", "$550.00"] },
      { id: "straw", cells: ["Pine straw", "10", "$5.00", "$50.00"] },
    ],
    totals: [{ id: "total", label: "Amount due", value: "$600.00" }],
    footnote: "Thank you for your business!",
  },
  reasons: [
    { id: "math", label: "Math error" },
    { id: "duplicate", label: "Duplicate or already paid" },
  ],
  decision: {
    prompt: "What should AP do?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
    ],
  },
  maxFlags: 2,
};

function Harness({
  initial,
  onChange,
  disabled,
  cfg = config,
}: {
  initial?: DocumentReviewAnswer;
  onChange?: (a: DocumentReviewAnswer) => void;
  disabled?: boolean;
  cfg?: DocumentReviewPublicConfig;
}) {
  const [answer, setAnswer] = useState(initial);
  return (
    <DocumentReviewStep
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

const flagButton = (name: string) => screen.getByRole("button", { name: `Flag ${name}` });

describe("DocumentReviewStep", () => {
  it("renders the document: header fields, lines, totals and footnote, each item flaggable", () => {
    render(<Harness />);
    const doc = screen.getByRole("article", { name: config.document.title });
    expect(within(doc).getByRole("heading", { name: config.document.title })).toBeVisible();
    expect(within(doc).getByText("GM-4417")).toBeVisible();
    expect(within(doc).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Description",
      "Qty",
      "Unit price",
      "Amount",
      "Flag",
    ]);
    expect(within(doc).getByText("$550.00")).toBeVisible();
    expect(within(doc).getByText("$600.00")).toBeVisible();
    expect(within(doc).getByText("Thank you for your business!")).toBeVisible();
    for (const name of ["Invoice #", "Terms", "Hardwood mulch", "Pine straw", "Amount due"]) {
      expect(flagButton(name)).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/0 of 2 flags used/)).toBeVisible();
  });

  it("flagging an item asks for a reason and a note, and emits the flag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(flagButton("Hardwood mulch"));
    expect(flagButton("Hardwood mulch")).toHaveAttribute("aria-pressed", "true");
    expect(onChange).toHaveBeenLastCalledWith({ flags: [{ target: "mulch", reason: "", note: "" }], decision: null });

    await user.selectOptions(screen.getByRole("combobox", { name: "Reason for Hardwood mulch" }), "math");
    await user.type(screen.getByRole("textbox", { name: "Note for Hardwood mulch" }), "40 × 12.50 = 500");
    expect(screen.getByRole("textbox", { name: "Note for Hardwood mulch" })).toHaveValue("40 × 12.50 = 500");
    expect(onChange).toHaveBeenLastCalledWith({
      flags: [{ target: "mulch", reason: "math", note: "40 × 12.50 = 500" }],
      decision: null,
    });
  });

  it("flags header fields too, and unflagging removes the flag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(flagButton("Invoice #"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Reason for Invoice #" }), "duplicate");
    expect(onChange).toHaveBeenLastCalledWith({ flags: [{ target: "invoice_no", reason: "duplicate", note: "" }], decision: null });
    await user.click(flagButton("Invoice #"));
    expect(screen.queryByRole("combobox", { name: "Reason for Invoice #" })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ flags: [], decision: null });
  });

  it("stops new flags at maxFlags but still allows unflagging", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(flagButton("Invoice #"));
    await user.click(flagButton("Amount due"));
    expect(screen.getByText(/2 of 2 flags used/)).toBeVisible();
    expect(flagButton("Terms")).toBeDisabled();
    expect(flagButton("Invoice #")).toBeEnabled();
    await user.click(flagButton("Invoice #"));
    expect(flagButton("Terms")).toBeEnabled();
  });

  it("records the decision alongside the flags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole("group", { name: "What should AP do?" });
    await user.click(within(group).getByRole("radio", { name: "Reject" }));
    expect(onChange).toHaveBeenLastCalledWith({ flags: [], decision: "reject" });
    await user.click(flagButton("Pine straw"));
    expect(onChange).toHaveBeenLastCalledWith({ flags: [{ target: "straw", reason: "", note: "" }], decision: "reject" });
  });

  it("has no decision group when the config has none", () => {
    const { decision: _d, ...rest } = config;
    void _d;
    render(<Harness cfg={rest} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("restores a saved answer", () => {
    render(<Harness initial={{ flags: [{ target: "total", reason: "math", note: "overstated" }], decision: "approve" }} />);
    expect(flagButton("Amount due")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Reason for Amount due" })).toHaveValue("math");
    expect(screen.getByRole("textbox", { name: "Note for Amount due" })).toHaveValue("overstated");
    expect(screen.getByRole("radio", { name: "Approve" })).toBeChecked();
  });

  it("disables every control when disabled", () => {
    render(<Harness disabled initial={{ flags: [{ target: "mulch", reason: "", note: "" }], decision: null }} />);
    for (const el of [...screen.getAllByRole("button"), ...screen.getAllByRole("radio"), screen.getByRole("combobox"), screen.getByRole("textbox")]) {
      expect(el).toBeDisabled();
    }
  });
});

describe('DocumentReviewStep "nothing wrong here"', () => {
  const withClean: DocumentReviewPublicConfig = { ...config, confirmClean: { label: "Nothing wrong with this invoice" } };
  const confirm = () => screen.getByRole("checkbox", { name: "Nothing wrong with this invoice" });

  it("isn't offered unless the config asks for it, and answers keep their old shape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(flagButton("Pine straw"));
    expect(onChange.mock.lastCall?.[0]).not.toHaveProperty("clean");
  });

  it("confirming emits clean: true with no flags; unconfirming clears it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness cfg={withClean} onChange={onChange} />);
    expect(confirm()).not.toBeChecked();
    await user.click(confirm());
    expect(onChange).toHaveBeenLastCalledWith({ flags: [], decision: null, clean: true });
    await user.click(confirm());
    expect(onChange).toHaveBeenLastCalledWith({ flags: [], decision: null, clean: false });
  });

  it("a confirmed document can't be flagged until the confirm is removed", async () => {
    const user = userEvent.setup();
    render(<Harness cfg={withClean} />);
    await user.click(confirm());
    expect(flagButton("Pine straw")).toBeDisabled();
    expect(screen.getByText("Remove the confirmation to flag items.")).toBeVisible();
    await user.click(confirm());
    expect(flagButton("Pine straw")).toBeEnabled();
  });

  it("can't be confirmed while items are flagged, and says why", async () => {
    const user = userEvent.setup();
    render(<Harness cfg={withClean} />);
    await user.click(flagButton("Pine straw"));
    expect(confirm()).toBeDisabled();
    expect(confirm()).toHaveAccessibleDescription("Remove your flags to confirm the document is clean.");
    await user.click(flagButton("Pine straw"));
    expect(confirm()).toBeEnabled();
  });

  it("keeps the decision alongside the confirm", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness cfg={withClean} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(confirm());
    expect(onChange).toHaveBeenLastCalledWith({ flags: [], decision: "approve", clean: true });
  });

  it("restores a saved confirm, and an old saved answer as not confirmed", () => {
    const { unmount } = render(<Harness cfg={withClean} initial={{ flags: [], decision: null, clean: true }} />);
    expect(confirm()).toBeChecked();
    unmount();
    render(<Harness cfg={withClean} initial={{ flags: [], decision: null }} />);
    expect(confirm()).not.toBeChecked();
  });

  it("is disabled when the step is", () => {
    render(<Harness cfg={withClean} disabled />);
    expect(confirm()).toBeDisabled();
  });
});
