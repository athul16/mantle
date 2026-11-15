/**
 * Monitoring v2 in the workspace: full screen required (cover + button, a note
 * where the browser has no Fullscreen API), the microphone (monitor, loss
 * cover, indicator), away captures while the candidate is in another window,
 * and the on-device gaze check (never blocks; a note when it can't run).
 * Media, uploads and the gaze/audio/away modules are faked.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeStream, fakeTrack, installMediaDevices, type FakeTrack } from "./fake-media";

vi.mock("@/lib/proctoring/client/snapshots", () => ({ takeSnapshot: vi.fn(async () => true) }));

const away = { left: vi.fn(), returned: vi.fn(), stop: vi.fn() };
vi.mock("@/lib/proctoring/client/away-capture", () => ({ createAwayCapture: vi.fn(() => away) }));

const gazeResult = { value: "ok" as "ok" | "unsupported" | "failed" };
const gazeMonitors: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock("@/lib/proctoring/client/gaze", () => ({
  createGazeMonitor: vi.fn(() => {
    const m = { start: vi.fn(async () => gazeResult.value), stop: vi.fn() };
    gazeMonitors.push(m);
    return m;
  }),
}));

type AudioOpts = { stream: MediaStream; onSignal: (k: string, p?: unknown) => void; maxClips?: number };
const audioMonitors: { opts: AudioOpts; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock("@/lib/proctoring/client/audio", () => ({
  createAudioMonitor: vi.fn((opts: AudioOpts) => {
    const m = { opts, start: vi.fn(), stop: vi.fn(async () => {}) };
    audioMonitors.push(m);
    return m;
  }),
}));

const { takeSnapshot } = await import("@/lib/proctoring/client/snapshots");
const { createAwayCapture } = await import("@/lib/proctoring/client/away-capture");
const { createGazeMonitor } = await import("@/lib/proctoring/client/gaze");
const { createAudioMonitor } = await import("@/lib/proctoring/client/audio");
const { Proctoring, ProctoringIndicators } = await import("@/lib/proctoring/client/proctoring");
const { SIGNAL_FLUSH_MS } = await import("@/lib/proctoring/client/use-browser-signals");
const { releaseMedia } = await import("@/lib/proctoring/client/media-store");

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response);
const signalKinds = () =>
  fetchMock.mock.calls
    .filter(([u]) => u === "/api/candidate/proctoring/signals")
    .flatMap(([, init]) => (JSON.parse((init as RequestInit).body as string) as { signals: { kind: string }[] }).signals.map((s) => s.kind));

const OFF = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false };
const Work = () => <button type="button">Inbox item</button>;
const gate = () => screen.queryByRole("dialog");

function audioTrack(): FakeTrack {
  return Object.assign(fakeTrack(), { kind: "audio" }) as unknown as FakeTrack;
}
function audioStream(track: FakeTrack): MediaStream {
  return { getTracks: () => [track], getVideoTracks: () => [], getAudioTracks: () => [track] } as unknown as MediaStream;
}

function setFullscreen(on: boolean) {
  Object.defineProperty(document, "fullscreenElement", { value: on ? document.documentElement : null, configurable: true });
  document.dispatchEvent(new Event("fullscreenchange"));
}
function installFullscreen(supported = true) {
  Object.defineProperty(document, "fullscreenEnabled", { value: supported, configurable: true });
  const request = vi.fn(async () => setFullscreen(true));
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: supported ? request : undefined, configurable: true });
  return request;
}

let media: ReturnType<typeof installMediaDevices>;
let camera: FakeTrack;
let mic: FakeTrack;

beforeEach(() => {
  releaseMedia();
  media = installMediaDevices();
  camera = fakeTrack();
  mic = audioTrack();
  media.getUserMedia.mockImplementation(async (c) => ((c as MediaStreamConstraints).audio ? audioStream(mic) : fakeStream(camera)));
  fetchMock.mockClear();
  vi.mocked(takeSnapshot).mockClear();
  vi.mocked(createAwayCapture).mockClear();
  vi.mocked(createGazeMonitor).mockClear();
  vi.mocked(createAudioMonitor).mockClear();
  away.left.mockClear();
  away.returned.mockClear();
  away.stop.mockClear();
  gazeMonitors.length = 0;
  audioMonitors.length = 0;
  gazeResult.value = "ok";
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  installFullscreen(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Full screen required", () => {
  it("covers the task until full screen, and again after leaving it; the timer keeps running", async () => {
    const request = installFullscreen(true);
    const user = userEvent.setup();
    render(
      <Proctoring settings={{ ...OFF, fullscreen: true }}>
        <Work />
      </Proctoring>,
    );
    expect(screen.getByRole("dialog", { name: "Go full screen to start" })).toBeInTheDocument();
    expect(screen.getByTestId("proctored-content")).toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Go full screen" }));
    expect(request).toHaveBeenCalled();
    await waitFor(() => expect(gate()).not.toBeInTheDocument());

    act(() => setFullscreen(false));
    expect(screen.getByRole("dialog", { name: "Return to full screen" })).toBeInTheDocument();
    expect(gate()).toHaveTextContent("The timer keeps running while this message is open; it does not pause.");
    await user.click(screen.getByRole("button", { name: "Go full screen" }));
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
  });

  it("doesn't block where the browser has no Fullscreen API, and says so", () => {
    render(
      <Proctoring settings={{ ...OFF, fullscreen: true }}>
        <Work />
      </Proctoring>,
    );
    expect(gate()).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("This browser can't run the test in full screen");
  });

  it("keeps the camera cover and the full-screen cover together", async () => {
    installFullscreen(true);
    render(
      <Proctoring settings={{ ...OFF, camera: true, fullscreen: true }}>
        <Work />
      </Proctoring>,
    );
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Go full screen to start" })).toBeInTheDocument());
    act(() => setFullscreen(true));
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
    act(() => camera.end());
    expect(screen.getByRole("dialog", { name: "We can't see your camera" })).toBeInTheDocument();
    setFullscreen(false);
  });
});

describe("Microphone", () => {
  it("starts a speech monitor once monitoring is on and shows a microphone chip", async () => {
    render(
      <Proctoring settings={{ ...OFF, microphone: true }} inlineIndicators>
        <ProctoringIndicators />
        <Work />
      </Proctoring>,
    );
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.anything(), video: false }));
    expect(createAudioMonitor).toHaveBeenCalledWith(expect.objectContaining({ maxClips: 300 }));
    expect(audioMonitors[0].start).toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Monitoring" })).toHaveTextContent("Microphone on");
  });

  it("covers the task when the microphone stops and turns it back on with a new monitor", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    render(
      <Proctoring settings={{ ...OFF, microphone: true }}>
        <Work />
      </Proctoring>,
    );
    await waitFor(() => expect(audioMonitors).toHaveLength(1));
    act(() => mic.end());
    expect(screen.getByRole("dialog", { name: "Your microphone is off" })).toBeInTheDocument();
    expect(gate()).toHaveTextContent("The timer keeps running");
    expect(audioMonitors[0].stop).toHaveBeenCalled();

    mic = audioTrack();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Turn on microphone" }));
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
    expect(audioMonitors).toHaveLength(2);
    await waitFor(() => expect(audioMonitors[1].start).toHaveBeenCalled());
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_MS));
    expect(signalKinds()).toEqual(expect.arrayContaining(["microphone_started", "microphone_stopped"]));
  });

  it("reuses the microphone the system check opened and starts listening on it", async () => {
    const { holdMedia } = await import("@/lib/proctoring/client/media-store");
    holdMedia("microphone", audioStream(mic));
    render(
      <Proctoring settings={{ ...OFF, microphone: true }}>
        <Work />
      </Proctoring>,
    );
    expect(gate()).not.toBeInTheDocument();
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(audioMonitors).toHaveLength(1);
    expect(audioMonitors[0].start).toHaveBeenCalled();
  });

  it("stops the monitor and the microphone when the workspace closes", async () => {
    const { unmount } = render(
      <Proctoring settings={{ ...OFF, microphone: true }}>
        <Work />
      </Proctoring>,
    );
    await waitFor(() => expect(audioMonitors).toHaveLength(1));
    unmount();
    expect(audioMonitors[0].stop).toHaveBeenCalled();
    expect(mic.stop).toHaveBeenCalled();
  });
});

describe("Away captures", () => {
  it("starts on leaving the window, ends on return and stops on unmount; no blur-time snapshot", async () => {
    const { unmount } = render(
      <Proctoring settings={{ ...OFF, camera: true }}>
        <Work />
      </Proctoring>,
    );
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
    expect(createAwayCapture).toHaveBeenCalledTimes(1);
    const { getStream } = vi.mocked(createAwayCapture).mock.calls[0][0];
    expect(getStream("camera")).toBeDefined();
    await waitFor(() => expect(takeSnapshot).toHaveBeenCalledWith("camera", expect.anything(), "interval"));
    vi.mocked(takeSnapshot).mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(away.left).toHaveBeenCalledTimes(1);
    expect(takeSnapshot).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(away.returned).toHaveBeenCalledTimes(1);
    unmount();
    expect(away.stop).toHaveBeenCalled();
  });
});

describe("Gaze check", () => {
  it("runs on the camera stream and is recreated when the camera changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    render(
      <Proctoring settings={{ ...OFF, camera: true, gaze: true }}>
        <Work />
      </Proctoring>,
    );
    await waitFor(() => expect(gazeMonitors).toHaveLength(1));
    expect(gazeMonitors[0].start).toHaveBeenCalled();
    const { onSignal } = vi.mocked(createGazeMonitor).mock.calls[0][0];
    act(() => onSignal("looking_away", { direction: "left" } as never));
    act(() => camera.end());
    expect(gazeMonitors[0].stop).toHaveBeenCalled();

    camera = fakeTrack();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Turn on camera" }));
    await waitFor(() => expect(gazeMonitors).toHaveLength(2));
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_MS));
    expect(signalKinds()).toContain("looking_away");
  });

  it("shows a small note, and never blocks, when the device can't run it", async () => {
    gazeResult.value = "unsupported";
    render(
      <Proctoring settings={{ ...OFF, camera: true, gaze: true }}>
        <Work />
      </Proctoring>,
    );
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent("Your device couldn't run the facing-the-screen check; your camera is still on."),
    );
    expect(gate()).not.toBeInTheDocument();
  });
});
