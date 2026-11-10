/** Dev engine preview (/dev/engine): inbox, step views, and scoring through a mocked server action. */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttemptScore, PublicMessage, PublicStep } from "@/lib/engine/types";
import { deferred } from "../helpers";

vi.mock("@/app/dev/engine/actions", () => ({ scoreDemoAttempt: vi.fn() }));

const { scoreDemoAttempt } = await import("@/app/dev/engine/actions");
const { DevWorkspace } = await import("@/app/dev/engine/workspace");
const score = vi.mocked(scoreDemoAttempt);

const messages: PublicMessage[] = [
  { id: "m1", from: "Dana", subject: "Count the petty cash", body: "Float is $200.", arriveAtMinute: 0, stepId: "expected" },
  { id: "m2", from: "Priya", subject: "Shortage?", body: "How much is missing?", arriveAtMinute: 5, stepId: "short" },
  { id: "m3", from: "IT", subject: "FYI", body: "No task here.", arriveAtMinute: 6 },
];
const steps: PublicStep[] = [
  { id: "expected", type: "numeric", title: "Expected cash", config: { prompt: "Expected cash on hand", unit: "$", decimals: 2 } },
  { id: "short", type: "numeric", title: "Shortage", config: { prompt: "Cash shortage", unit: "$", decimals: 2 } },
];
const result: AttemptScore = {
  points: 3,
  maxPoints: 4,
  steps: {
    expected: { points: 2, maxPoints: 2, items: [{ id: "v", label: "Value", earned: 2, max: 2 }] },
    short: { points: 1, maxPoints: 2, items: [{ id: "v", label: "Value", earned: 1, max: 2, note: "within $1" }], needsReview: true },
  },
};

beforeEach(() => vi.clearAllMocks());

const setup = (msgs = messages) => {
  const user = userEvent.setup();
  render(<DevWorkspace slug="demo-petty-cash" seed="abc" messages={msgs} steps={steps} />);
  return user;
};
const inbox = () => screen.getByRole("list");

describe("DevWorkspace", () => {
  it("lists messages with their arrival minute and opens the newest one", () => {
    setup();
    const items = within(inbox()).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual([
      "DanaCount the petty cashminute 0",
      "PriyaShortage?minute 5",
      "ITFYIminute 6",
    ]);
    expect(screen.getByRole("heading", { level: 3, name: "FYI" })).toBeVisible();
    expect(screen.getByText("From IT")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("says so when there are no messages", () => {
    setup([]);
    expect(screen.getByText("No messages yet.")).toBeVisible();
  });

  it("shows the step a message delivers and keeps answers when switching", async () => {
    const user = setup();
    await user.click(within(inbox()).getByRole("button", { name: /Count the petty cash/ }));
    expect(screen.getByRole("heading", { level: 4, name: "Expected cash" })).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Expected cash on hand" }), "200");
    await user.click(within(inbox()).getByRole("button", { name: /Shortage\?/ }));
    expect(screen.getByRole("textbox", { name: "Cash shortage" })).toHaveValue("");
    await user.click(within(inbox()).getByRole("button", { name: /Count the petty cash/ }));
    expect(screen.getByRole("textbox", { name: "Expected cash on hand" })).toHaveValue("200");
  });

  it("scores the answers, disabling inputs while it runs, and shows the result", async () => {
    const user = setup();
    await user.click(within(inbox()).getByRole("button", { name: /Count the petty cash/ }));
    await user.type(screen.getByRole("textbox", { name: "Expected cash on hand" }), "200");
    const pending = deferred<AttemptScore>();
    score.mockReturnValueOnce(pending.promise);

    await user.click(screen.getByRole("button", { name: "Submit and score" }));
    expect(await screen.findByRole("button", { name: "Scoring…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Expected cash on hand" })).toBeDisabled();
    expect(score).toHaveBeenCalledWith("demo-petty-cash", "abc", { expected: { value: 200 } });

    await act(async () => pending.resolve(result));
    const out = await screen.findByTestId("score");
    expect(within(out).getByText("Score: 3 / 4")).toBeVisible();
    const lines = within(out).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual(["expected: 2/2", "short: 1/2 (needs review) · within $1"]);
    expect(screen.getByRole("button", { name: "Submit and score" })).toBeEnabled();
  });

  it("shows the error when scoring fails", async () => {
    const user = setup();
    score.mockRejectedValueOnce(new Error("unknown scenario"));
    await user.click(screen.getByRole("button", { name: "Submit and score" }));
    expect(await screen.findByText("unknown scenario")).toBeVisible();
    expect(screen.queryByTestId("score")).not.toBeInTheDocument();
  });

  it("clears an old error on the next try", async () => {
    const user = setup();
    score.mockRejectedValueOnce("boom").mockResolvedValueOnce(result);
    await user.click(screen.getByRole("button", { name: "Submit and score" }));
    expect(await screen.findByText("boom")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Submit and score" }));
    expect(await screen.findByTestId("score")).toBeVisible();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });
});
