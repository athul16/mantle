/** `ordering` step view: a list the candidate reorders with up/down buttons, the keyboard or by dragging a handle. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StepView } from "@/lib/engine/client/StepView";
import { OrderingStep } from "@/lib/engine/step-types/ordering/client";
import type { OrderingAnswer, OrderingPublicConfig } from "@/lib/engine/step-types/ordering/public";
import { orderingServer } from "@/lib/engine/step-types/ordering/server";

const items = [
  { id: "c", label: "Orthopedic consult" },
  { id: "a", label: "ER visit", detail: "Day of the crash" },
  { id: "f", label: "Discharge from therapy" },
  { id: "b", label: "Primary care follow-up" },
  { id: "e", label: "Physical therapy, week 6" },
  { id: "d", label: "MRI of the lumbar spine" },
];
const config: OrderingPublicConfig = { prompt: "Put the visits in date order.", items };
const shown = items.map((i) => i.id);

function Harness({ initial, onChange, disabled }: { initial?: OrderingAnswer; onChange?: (a: OrderingAnswer) => void; disabled?: boolean }) {
  const [answer, setAnswer] = useState(initial);
  return (
    <OrderingStep
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

const list = () => screen.getByRole("list", { name: "Your order" });
const labels = () => within(list()).getAllByRole("listitem").map((li) => li.getAttribute("data-label"));
const labelsOf = (ids: string[]) => ids.map((id) => items.find((i) => i.id === id)!.label);

describe("OrderingStep", () => {
  it("lists every item in the order shown, numbered, with its detail", () => {
    render(<Harness />);
    expect(labels()).toEqual(labelsOf(shown));
    const first = within(list()).getAllByRole("listitem")[1];
    expect(first).toHaveTextContent("2");
    expect(first).toHaveTextContent("ER visit");
    expect(first).toHaveTextContent("Day of the crash");
    expect(screen.getByRole("button", { name: 'Move "Orthopedic consult" up' })).toBeDisabled();
    expect(screen.getByRole("button", { name: 'Move "MRI of the lumbar spine" down' })).toBeDisabled();
  });

  it("moves items with the up and down buttons and saves the whole order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: 'Move "ER visit" up' }));
    expect(onChange).toHaveBeenLastCalledWith({ order: ["a", "c", "f", "b", "e", "d"] });
    expect(labels()).toEqual(labelsOf(["a", "c", "f", "b", "e", "d"]));
    // Focus stays with the moved item; at the top its up button is disabled, so focus goes to its down button.
    expect(screen.getByRole("button", { name: 'Move "ER visit" down' })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: 'Move "Orthopedic consult" down' }));
    expect(onChange).toHaveBeenLastCalledWith({ order: ["a", "f", "c", "b", "e", "d"] });
    expect(screen.getByRole("status")).toHaveTextContent('"Orthopedic consult" moved to position 3 of 6.');
  });

  it("moves an item with the arrow keys on its handle, Home and End too", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const handle = screen.getByRole("button", { name: /^Reorder "Primary care follow-up", position 4 of 6/ });
    handle.focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ order: ["c", "a", "b", "f", "e", "d"] });
    expect(screen.getByRole("button", { name: /^Reorder "Primary care follow-up", position 3 of 6/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith({ order: ["b", "c", "a", "f", "e", "d"] });
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith({ order: ["c", "a", "f", "e", "d", "b"] });
    await user.keyboard("{ArrowDown}"); // already last: nothing changes
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("moves an item by dragging its handle (pointer events, so touch works too)", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    // jsdom has no layout: give each row a 40px slot.
    within(list())
      .getAllByRole("listitem")
      .forEach((li, i) => {
        li.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: i * 40, toJSON() {} });
      });
    const handle = screen.getByRole("button", { name: /^Reorder "Orthopedic consult"/ });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 20, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 135 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 135 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ order: ["a", "f", "b", "c", "e", "d"] });
  });

  it("can keep the shown order as the answer before anything moves", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Keep this order" }));
    expect(onChange).toHaveBeenLastCalledWith({ order: shown });
    expect(screen.queryByRole("button", { name: "Keep this order" })).not.toBeInTheDocument();
  });

  it("restores a saved answer, ignoring one that doesn't fit the items", () => {
    const { unmount } = render(<Harness initial={{ order: ["f", "e", "d", "c", "b", "a"] }} />);
    expect(labels()).toEqual(labelsOf(["f", "e", "d", "c", "b", "a"]));
    expect(screen.queryByRole("button", { name: "Keep this order" })).not.toBeInTheDocument();
    unmount();
    render(<Harness initial={{ order: ["a", "zz"] }} />);
    expect(labels()).toEqual(labelsOf(shown));
  });

  it("disables every control when disabled", () => {
    render(<Harness disabled initial={{ order: shown }} />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("renders through StepView by type", () => {
    render(<StepView step={{ id: "chrono", type: "ordering", title: "Chronology", config }} onChange={() => {}} />);
    expect(screen.getByRole("list", { name: "Your order" })).toBeVisible();
  });

  it("the DOM is the same whatever the key says (the order key never reaches the browser)", () => {
    const authored = orderingServer.configSchema.parse({ prompt: config.prompt, items, positionPoints: 2, pairwisePoints: 2 });
    const doms = new Set<string>();
    for (const order of [["a", "b", "c", "d", "e", "f"], ["f", "e", "d", "c", "b", "a"]]) {
      orderingServer.keySchema.parse({ order });
      const pub = orderingServer.toPublic(authored, { variant: { values: {}, keys: { chrono: { order } } }, fill: (t) => t });
      const { container, unmount } = render(<StepView step={{ id: "chrono", type: "ordering", title: "Chronology", config: pub }} onChange={() => {}} />);
      doms.add(container.innerHTML.replace(/(?:[«:]r[0-9a-z]+[»:]|_r_[0-9a-z]+_)/g, "id"));
      expect(container.innerHTML).not.toMatch(/points|pairwise|correct/i);
      unmount();
    }
    expect(doms.size).toBe(1);
  });
});
