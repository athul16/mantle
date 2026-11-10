/**
 * Browser signals during an attempt: leaving the window, copy/paste and
 * leaving full screen become timestamped signals, batched to the server.
 * Pasted text itself is never sent, only its length.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "@/lib/proctoring/client/use-browser-signals";

const { useBrowserSignals, SIGNAL_FLUSH_MS } = await import("@/lib/proctoring/client/use-browser-signals");

const NOW = "2026-11-10T10:00:00.000Z";
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response);
const sent = () =>
  fetchMock.mock.calls
    .filter(([u]) => u === "/api/candidate/proctoring/signals")
    .flatMap(([, init]) => (JSON.parse((init as RequestInit).body as string) as { signals: Signal[] }).signals);
const jestShim = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };

let seen: Signal[] = [];
function Harness() {
  useBrowserSignals({ onSignal: (s) => seen.push(s) });
  return <p>workspace</p>;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
const flush = () => act(() => vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_MS));

beforeEach(() => {
  vi.stubGlobal("jest", jestShim);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(NOW));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  seen = [];
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBrowserSignals", () => {
  it("records leaving and returning to the window once, even when blur and tab hiding both fire", async () => {
    render(<Harness />);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      setHidden(true);
    });
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    act(() => {
      setHidden(false);
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(sent()).toEqual([
      { kind: "left_window", at: NOW },
      { kind: "returned_to_window", at: "2026-11-10T10:00:12.000Z", awayMs: 12_000 },
    ]);
    expect(seen.map((s) => s.kind)).toEqual(["left_window", "returned_to_window"]);
  });

  it("records pastes and copies by length only", async () => {
    render(<Harness />);
    const paste = Object.assign(new Event("paste", { bubbles: true }), {
      clipboardData: { getData: (type: string) => (type === "text/plain" ? "secret answer 1234" : "") },
    });
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "copied bit" } as Selection);
    act(() => {
      document.body.dispatchEvent(paste);
      document.body.dispatchEvent(new Event("copy", { bubbles: true }));
    });
    await flush();
    expect(sent()).toEqual([
      { kind: "pasted", at: NOW, chars: 18 },
      { kind: "copied", at: NOW, chars: 10 },
    ]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("secret answer");
  });

  it("records leaving full screen, but not entering it", async () => {
    render(<Harness />);
    act(() => {
      Object.defineProperty(document, "fullscreenElement", { value: document.documentElement, configurable: true });
      document.dispatchEvent(new Event("fullscreenchange"));
      Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await flush();
    expect(sent()).toEqual([{ kind: "fullscreen_exited", at: NOW }]);
  });

  it("batches signals and sends nothing when there is nothing to send", async () => {
    render(<Harness />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends what is pending with keepalive when the page is closed", () => {
    render(<Harness />);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: true });
  });

  it("puts signals back in the queue when sending fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<Harness />);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent()).toEqual([
      { kind: "left_window", at: NOW },
      { kind: "left_window", at: NOW },
    ]);
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = render(<Harness />);
    unmount();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await flush();
    expect(seen).toEqual([]);
  });
});
