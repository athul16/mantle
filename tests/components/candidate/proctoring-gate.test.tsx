/**
 * Monitoring during the attempt: the workspace stays covered until the
 * camera is on and the entire screen is shared, snapshots are taken at an
 * interval and on events, and losing either brings the cover back (the
 * server timer keeps running). Media and uploads are faked.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domError, fakeStream, fakeTrack, installMediaDevices, type FakeTrack } from "./fake-media";

vi.mock("@/lib/proctoring/client/snapshots", () => ({ takeSnapshot: vi.fn(async () => true) }));
const { takeSnapshot } = await import("@/lib/proctoring/client/snapshots");
const { Proctoring } = await import("@/lib/proctoring/client/proctoring");
const { SNAPSHOT_INTERVAL_MS } = await import("@/lib/proctoring/config");
const { SIGNAL_FLUSH_MS } = await import("@/lib/proctoring/client/use-browser-signals");
const { releaseMedia } = await import("@/lib/proctoring/client/media-store");

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response);
const signalKinds = () =>
  fetchMock.mock.calls
    .filter(([u]) => u === "/api/candidate/proctoring/signals")
    .flatMap(([, init]) => (JSON.parse((init as RequestInit).body as string) as { signals: { kind: string }[] }).signals.map((s) => s.kind));
const snapshotSources = () => vi.mocked(takeSnapshot).mock.calls.map(([source]) => source);

let media: ReturnType<typeof installMediaDevices>;
let camera: FakeTrack;
let shared: FakeTrack;

const Workspace = () => <button type="button">Inbox item</button>;
// The cover's heading names what's wrong ("Screen sharing stopped", "We can't see your camera",
// or "Turn on monitoring to continue" before anything has started).
const gate = () => screen.queryByRole("dialog");

beforeEach(() => {
  releaseMedia();
  media = installMediaDevices();
  camera = fakeTrack();
  shared = fakeTrack({ displaySurface: "monitor" });
  media.getUserMedia.mockResolvedValue(fakeStream(camera));
  media.getDisplayMedia.mockResolvedValue(fakeStream(shared));
  fetchMock.mockClear();
  vi.mocked(takeSnapshot).mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Proctoring off", () => {
  it("shows the workspace straight away and asks for nothing", () => {
    render(
      <Proctoring settings={{ camera: false, screen: false }}>
        <Workspace />
      </Proctoring>,
    );
    expect(gate()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inbox item" })).toBeVisible();
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("Proctoring on", () => {
  async function activate() {
    const user = userEvent.setup();
    render(
      <Proctoring settings={{ camera: true, screen: true }}>
        <Workspace />
      </Proctoring>,
    );
    await waitFor(() => expect(screen.getByRole("status", { name: "Monitoring" })).toHaveTextContent("Camera on"));
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
    return user;
  }

  it("covers the workspace until the camera is on and the entire screen is shared", async () => {
    render(
      <Proctoring settings={{ camera: true, screen: true }}>
        <Workspace />
      </Proctoring>,
    );
    expect(gate()).toBeInTheDocument();
    expect(gate()).toHaveTextContent("The timer keeps running while this message is open; it does not pause.");
    // The covered workspace can't be reached by keyboard or screen reader.
    expect(screen.getByTestId("proctored-content")).toHaveAttribute("inert");
    await waitFor(() => expect(media.getUserMedia).toHaveBeenCalled());
    expect(gate()).toBeInTheDocument();
  });

  it("opens the workspace once both are on, shows their status and takes the first snapshots", async () => {
    await activate();
    expect(screen.getByTestId("proctored-content")).not.toHaveAttribute("inert");
    const status = screen.getByRole("status", { name: "Monitoring" });
    expect(status).toHaveTextContent("Camera on");
    expect(status).toHaveTextContent("Screen shared");
    expect(screen.getByLabelText("Camera preview")).toBeInTheDocument();
    await waitFor(() => expect(snapshotSources().sort()).toEqual(["camera", "screen"]));
  });

  it("takes snapshots again at the interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await activate();
    await waitFor(() => expect(snapshotSources()).toHaveLength(2));
    await act(() => vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS));
    expect(snapshotSources()).toHaveLength(4);
  });

  it("takes snapshots when the candidate leaves the window", async () => {
    await activate();
    await waitFor(() => expect(snapshotSources()).toHaveLength(2));
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() => expect(snapshotSources()).toHaveLength(4));
  });

  it("brings the cover back and records it when screen sharing stops", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    await activate();
    act(() => shared.end());
    expect(screen.getByRole("dialog", { name: "Screen sharing stopped" })).toBeInTheDocument();
    expect(gate()).toHaveTextContent("Screen sharing stopped. Share your entire screen again to continue. The timer keeps running.");
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_MS));
    expect(signalKinds()).toContain("screen_share_stopped");

    shared = fakeTrack({ displaySurface: "monitor" });
    media.getDisplayMedia.mockResolvedValueOnce(fakeStream(shared));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
  });

  it("brings the cover back when the camera turns off", async () => {
    await activate();
    act(() => camera.end());
    expect(screen.getByRole("dialog", { name: "We can't see your camera" })).toBeInTheDocument();
    expect(gate()).toHaveTextContent("Your camera turned off. Turn it back on to continue. The timer keeps running.");
    expect(screen.getByRole("button", { name: "Turn on camera" })).toBeVisible();
  });

  it("refuses a window or tab share and records it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    const tab = fakeTrack({ displaySurface: "window" });
    media.getDisplayMedia.mockResolvedValueOnce(fakeStream(tab));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <Proctoring settings={{ camera: false, screen: true }}>
        <Workspace />
      </Proctoring>,
    );
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(gate()).toHaveTextContent("You shared a window or tab. Choose “Entire screen” instead."));
    expect(tab.stop).toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_MS));
    expect(signalKinds()).toContain("screen_share_wrong_surface");
  });

  it("explains a cancelled share", async () => {
    media.getDisplayMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const user = userEvent.setup();
    render(
      <Proctoring settings={{ camera: false, screen: true }}>
        <Workspace />
      </Proctoring>,
    );
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() =>
      expect(gate()).toHaveTextContent("Screen sharing was cancelled. You need to share your entire screen to take this test."),
    );
  });

  it("records a second display", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    await activate();
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_MS));
    expect(signalKinds()).toContain("multiple_displays");
  });

  it("reuses streams the system check already opened, without asking again", async () => {
    const { holdMedia } = await import("@/lib/proctoring/client/media-store");
    holdMedia("camera", fakeStream(camera));
    holdMedia("screen", fakeStream(shared));
    render(
      <Proctoring settings={{ camera: true, screen: true }}>
        <Workspace />
      </Proctoring>,
    );
    expect(gate()).not.toBeInTheDocument();
    expect(media.getDisplayMedia).not.toHaveBeenCalled();
  });
});
