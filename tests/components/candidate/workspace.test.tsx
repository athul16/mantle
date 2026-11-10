/**
 * Candidate workspace: inbox, opening messages, step switching, the display
 * countdown, polling for scheduled messages and autosave. fetch, the router
 * and timers are mocked; the server stays the source of truth.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMessage, PublicStep } from "@/lib/engine/types";

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { Workspace } = await import("@/app/a/[token]/workspace/workspace");

const SERVER_NOW = "2026-11-09T10:00:00.000Z";
const minutesFrom = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

const messages: PublicMessage[] = [
  { id: "m2", from: "Priya (Controller)", subject: "Adjusted balance?", body: "What's the adjusted balance?", arriveAtMinute: 5, stepId: "num" },
  { id: "m1", from: "Dana (Manager)", subject: "Bank rec for October", body: "Please finish the rec.", arriveAtMinute: 0, stepId: "rec" },
  { id: "m0", from: "IT", subject: "Welcome", body: "Your laptop is ready.", arriveAtMinute: 0 },
];
const steps: PublicStep[] = [
  { id: "rec", type: "inbox_reply", title: "Reply to Dana", config: { prompt: "Write back to Dana.", maxChars: 500 } },
  { id: "num", type: "numeric", title: "Adjusted balance", config: { prompt: "Adjusted cash balance", unit: "$", decimals: 2 } },
];

function view(over: Partial<Parameters<typeof Workspace>[0]["initial"]> = {}) {
  return {
    title: "Mini month-end close",
    intro: "You're the new staff accountant at Harbor Lane.",
    messages,
    steps,
    answers: {},
    deadlineAt: minutesFrom(SERVER_NOW, 45),
    serverNow: SERVER_NOW,
    ...over,
  };
}

type Reply = { status?: number; body?: unknown } | Error;
let replies: Record<string, Reply[]>;
const fetchMock = vi.fn(async (url: string) => {
  const queue = replies[url] ?? [];
  const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? { status: 200, body: {} });
  if (next instanceof Error) throw next;
  const status = next.status ?? 200;
  return { ok: status >= 200 && status < 300, status, json: async () => next.body } as Response;
});
const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const bodiesTo = (url: string) => callsTo(url).map(([, init]) => JSON.parse((init as RequestInit).body as string));

// Testing Library's async wrapper ends with a setTimeout(0) that it only
// advances when it sees Jest's fake timers. Give it a Jest-shaped handle so it
// advances Vitest's fake clock instead of waiting forever.
const jestShim = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };

beforeEach(() => {
  vi.stubGlobal("jest", jestShim);
  // Fake only timers and Date: React schedules work with setImmediate in jsdom, which must stay real.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(SERVER_NOW));
  replies = {};
  fetchMock.mockClear();
  Object.values(router).forEach((f) => f.mockClear());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = (initial = view()) => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<Workspace token="tok" initial={initial} />);
  return user;
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const timer = () => screen.getByRole("timer");
const inbox = () => screen.getByRole("list");
const messageButton = (subject: string) => within(inbox()).getByRole("button", { name: new RegExp(subject) });
const saveStatus = () => document.querySelector('[aria-live="polite"]')!;

describe("Workspace layout", () => {
  it("shows the title, intro and a prompt to open a message", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Mini month-end close" })).toBeVisible();
    expect(screen.getByText("You're the new staff accountant at Harbor Lane.")).toBeVisible();
    expect(screen.getByText("Open a message in the inbox to start.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review and submit" })).toHaveAttribute("href", "/a/tok/review");
  });

  it("lists every message with sender, subject and arrival, all unread", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Inbox · 3 unread" })).toBeVisible();
    const items = within(inbox()).getAllByRole("button");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Priya (Controller)");
    expect(items[0]).toHaveTextContent("Adjusted balance?");
    expect(items[0]).toHaveTextContent("5 min in");
    expect(items[1]).toHaveTextContent("At start");
    expect(within(inbox()).getAllByLabelText("unread")).toHaveLength(3);
  });
});

describe("opening messages", () => {
  it("shows the message and the task it delivers, and marks it read", async () => {
    const user = setup();
    await user.click(messageButton("Bank rec for October"));
    expect(screen.getByRole("heading", { level: 3, name: "Bank rec for October" })).toBeVisible();
    expect(screen.getByText("From Dana (Manager)")).toBeVisible();
    expect(screen.getByText("Please finish the rec.")).toBeVisible();
    expect(screen.getByRole("heading", { level: 4, name: "Reply to Dana" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Inbox · 2 unread" })).toBeVisible();
    expect(within(messageButton("Bank rec for October")).queryByLabelText("unread")).not.toBeInTheDocument();
    expect(screen.queryByText("Open a message in the inbox to start.")).not.toBeInTheDocument();
  });

  it("shows no task for an info-only message", async () => {
    const user = setup();
    await user.click(messageButton("Welcome"));
    expect(screen.getByText("Your laptop is ready.")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("logs opened_message once per message and started_step once per step", async () => {
    const user = setup();
    await user.click(messageButton("Bank rec for October"));
    await user.click(messageButton("Welcome"));
    await user.click(messageButton("Bank rec for October"));
    expect(bodiesTo("/api/candidate/event")).toEqual([
      { kind: "opened_message", messageId: "m1" },
      { kind: "started_step", stepId: "rec" },
      { kind: "opened_message", messageId: "m0" },
    ]);
  });

  it("keeps working if logging an event fails", async () => {
    replies["/api/candidate/event"] = [new Error("offline")];
    const user = setup();
    await user.click(messageButton("Bank rec for October"));
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeVisible();
  });

  it("switches between steps and keeps each step's answer", async () => {
    const user = setup();
    await user.click(messageButton("Bank rec for October"));
    await user.type(screen.getByRole("textbox", { name: "Reply" }), "On it.");
    await user.click(messageButton("Adjusted balance?"));
    expect(screen.getByRole("heading", { level: 4, name: "Adjusted balance" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Adjusted cash balance" }), "1,234.56");
    await user.click(messageButton("Bank rec for October"));
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("On it.");
    await user.click(messageButton("Adjusted balance?"));
    expect(screen.getByRole("textbox", { name: "Adjusted cash balance" })).toHaveValue("1234.56");
  });

  it("starts from answers the server already has", async () => {
    const user = setup(view({ answers: { rec: { body: "Saved earlier" } } }));
    await user.click(messageButton("Bank rec for October"));
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Saved earlier");
  });
});

describe("countdown (display only)", () => {
  it("counts down from the server's remaining time each second", async () => {
    setup();
    expect(timer()).toHaveTextContent("45:00");
    await advance(1000);
    expect(timer()).toHaveTextContent("44:59");
    await advance(59_000);
    expect(timer()).toHaveTextContent("44:00");
  });

  it("shows hours when more than an hour is left", () => {
    setup(view({ deadlineAt: minutesFrom(SERVER_NOW, 125) }));
    expect(timer()).toHaveTextContent("2:05:00");
  });

  it("uses the server clock, not a wrong browser clock", async () => {
    // The browser thinks it's 3 hours later than the server does.
    vi.setSystemTime(new Date(new Date(SERVER_NOW).getTime() + 3 * 3600_000));
    setup();
    expect(timer()).toHaveTextContent("45:00");
    await advance(1000);
    expect(timer()).toHaveTextContent("44:59");
  });

  it("turns red under five minutes", async () => {
    setup(view({ deadlineAt: minutesFrom(SERVER_NOW, 5) }));
    expect(timer()).not.toHaveClass("text-red-600");
    await advance(1000);
    expect(timer()).toHaveTextContent("4:59");
    expect(timer()).toHaveClass("text-red-600");
  });

  it("stops at 0:00 and asks the server, which sends the candidate to the done page", async () => {
    replies["/api/candidate/state"] = [{ body: { status: "submitted" } }];
    setup(view({ deadlineAt: minutesFrom(SERVER_NOW, 2 / 60) }));
    await advance(3000);
    expect(timer()).toHaveTextContent("0:00");
    expect(callsTo("/api/candidate/state").length).toBeGreaterThan(0);
    expect(router.replace).toHaveBeenCalledWith("/a/tok/done");
    expect(router.replace).toHaveBeenCalledTimes(1);
  });
});

describe("polling", () => {
  it("asks for new state every 20 seconds and shows messages that have arrived", async () => {
    const arrived: PublicMessage = { id: "m3", from: "Marcus Lee", subject: "Where did my money go?", body: "Help", arriveAtMinute: 10 };
    replies["/api/candidate/state"] = [{ body: { status: "in_progress", view: view({ messages: [arrived, ...messages] }) } }];
    setup();
    await advance(19_000);
    expect(callsTo("/api/candidate/state")).toHaveLength(0);
    await advance(1000);
    expect(callsTo("/api/candidate/state")).toHaveLength(1);
    expect(callsTo("/api/candidate/state")[0][1]).toEqual({ cache: "no-store" });
    expect(messageButton("Where did my money go?")).toHaveTextContent("10 min in");
    expect(screen.getByRole("heading", { name: "Inbox · 4 unread" })).toBeVisible();
  });

  it("keeps what the candidate typed over the server's copy", async () => {
    replies["/api/candidate/state"] = [{ body: { status: "in_progress", view: view({ answers: { rec: { body: "older server copy" } } }) } }];
    const user = setup();
    await user.click(messageButton("Bank rec for October"));
    await user.type(screen.getByRole("textbox", { name: "Reply" }), "typed locally");
    await advance(20_000);
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("typed locally");
  });

  it("sends the candidate back to the start when the session has expired", async () => {
    replies["/api/candidate/state"] = [{ status: 401 }];
    setup();
    await advance(20_000);
    expect(router.replace).toHaveBeenCalledWith("/a/tok");
  });

  it("goes to the done page once the attempt is no longer in progress", async () => {
    replies["/api/candidate/state"] = [{ body: { status: "submitted" } }];
    setup();
    await advance(20_000);
    expect(router.replace).toHaveBeenCalledWith("/a/tok/done");
  });

  it("ignores a failed poll and tries again next time", async () => {
    replies["/api/candidate/state"] = [new Error("offline"), { body: { status: "in_progress", view: view() } }];
    setup();
    await advance(20_000);
    expect(router.replace).not.toHaveBeenCalled();
    await advance(20_000);
    expect(callsTo("/api/candidate/state")).toHaveLength(2);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("autosave", () => {
  async function typeReply(user: ReturnType<typeof setup>, text: string) {
    await user.click(messageButton("Bank rec for October"));
    await user.type(screen.getByRole("textbox", { name: "Reply" }), text);
  }

  it("says Saving… at once, saves the latest answer after a pause, then says saved", async () => {
    replies["/api/candidate/answer"] = [{ status: 200, body: { ok: true } }];
    const user = setup();
    expect(saveStatus()).toHaveTextContent("");
    await typeReply(user, "Hi Dana");
    expect(saveStatus()).toHaveTextContent("Saving…");
    expect(callsTo("/api/candidate/answer")).toHaveLength(0);
    await advance(700);
    expect(bodiesTo("/api/candidate/answer")).toEqual([{ stepId: "rec", answer: { body: "Hi Dana" } }]);
    expect(callsTo("/api/candidate/answer")[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(saveStatus()).toHaveTextContent("All changes saved");
  });

  it("debounces per step: quick typing sends one save", async () => {
    const user = setup();
    await typeReply(user, "abc");
    await advance(699);
    expect(callsTo("/api/candidate/answer")).toHaveLength(0);
    await advance(1);
    expect(callsTo("/api/candidate/answer")).toHaveLength(1);
  });

  it("saves two steps separately", async () => {
    const user = setup();
    await typeReply(user, "x");
    await user.click(messageButton("Adjusted balance?"));
    await user.type(screen.getByRole("textbox", { name: "Adjusted cash balance" }), "9");
    await advance(700);
    expect(bodiesTo("/api/candidate/answer")).toEqual([
      { stepId: "rec", answer: { body: "x" } },
      { stepId: "num", answer: { value: 9 } },
    ]);
  });

  it("shows an error when the server rejects the save", async () => {
    replies["/api/candidate/answer"] = [{ status: 500 }];
    const user = setup();
    await typeReply(user, "x");
    await advance(700);
    expect(saveStatus()).toHaveTextContent("Couldn't save. Check your connection.");
    expect(saveStatus()).toHaveClass("text-red-600");
  });

  it("shows an error when offline, and recovers on the next good save", async () => {
    replies["/api/candidate/answer"] = [new Error("offline"), { status: 200 }];
    const user = setup();
    await typeReply(user, "x");
    await advance(700);
    expect(saveStatus()).toHaveTextContent("Couldn't save. Check your connection.");
    await user.type(screen.getByRole("textbox", { name: "Reply" }), "y");
    expect(saveStatus()).toHaveTextContent("Saving…");
    await advance(700);
    expect(saveStatus()).toHaveTextContent("All changes saved");
  });

  it("goes to the done page when the attempt was already submitted (409)", async () => {
    replies["/api/candidate/answer"] = [{ status: 409 }];
    const user = setup();
    await typeReply(user, "x");
    await advance(700);
    expect(router.replace).toHaveBeenCalledWith("/a/tok/done");
  });

  it("sends the candidate back to the start when the session expired (401)", async () => {
    replies["/api/candidate/answer"] = [{ status: 401 }];
    const user = setup();
    await typeReply(user, "x");
    await advance(700);
    expect(router.replace).toHaveBeenCalledWith("/a/tok");
  });

  it("keeps saving a numeric answer typed with commas and a dollar sign as a number", async () => {
    const user = setup();
    await user.click(messageButton("Adjusted balance?"));
    fireEvent.change(screen.getByRole("textbox", { name: "Adjusted cash balance" }), { target: { value: "$1,200.50" } });
    await advance(700);
    expect(bodiesTo("/api/candidate/answer")).toEqual([{ stepId: "num", answer: { value: 1200.5 } }]);
  });
});
