/**
 * System check with the microphone and the gaze check: the microphone is asked
 * for after consent, a short "say something" check listens for speech (and lets
 * the candidate continue after 10 s anyway), the stream is kept for the
 * workspace, and the gaze model is warmed with a trial run that only shows a
 * note if the device can't run it. Media and monitors are faked.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domError, fakeStream, fakeTrack, installMediaDevices, type FakeTrack } from "./fake-media";

vi.mock("@/lib/proctoring/client/snapshots", () => ({ takeSnapshot: vi.fn(async () => true) }));

type AudioOpts = { stream: MediaStream; onSignal: (k: string, p?: unknown) => void; upload?: unknown };
const audioMonitors: { opts: AudioOpts; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock("@/lib/proctoring/client/audio", () => ({
  createAudioMonitor: vi.fn((opts: AudioOpts) => {
    const m = { opts, start: vi.fn(), stop: vi.fn(async () => {}) };
    audioMonitors.push(m);
    return m;
  }),
}));

const gazeResult = { value: "ok" as "ok" | "unsupported" | "failed" };
const gazeMonitors: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock("@/lib/proctoring/client/gaze", () => ({
  createGazeMonitor: vi.fn(() => {
    const m = { start: vi.fn(async () => gazeResult.value), stop: vi.fn() };
    gazeMonitors.push(m);
    return m;
  }),
}));

async function load() {
  vi.resetModules();
  const mod = await import("@/app/a/[token]/check/system-check");
  const proctoring = await import("@/lib/proctoring/client/proctoring");
  return { SystemCheck: mod.SystemCheck, heldMicrophone: proctoring.heldMicrophone };
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response);
const signalKinds = () =>
  fetchMock.mock.calls
    .filter(([u]) => u === "/api/candidate/proctoring/signals")
    .flatMap(([, init]) => (JSON.parse((init as RequestInit).body as string) as { signals: { kind: string }[] }).signals.map((s) => s.kind));
const row = (label: string) => screen.getAllByRole("listitem").find((li) => li.querySelector(".strong")?.textContent === label)!;
const continueLink = () => screen.queryByRole("link", { name: "Continue" });
const OFF = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false };

function audioStream(track: FakeTrack): MediaStream {
  return { getTracks: () => [track], getVideoTracks: () => [], getAudioTracks: () => [track] } as unknown as MediaStream;
}

let media: ReturnType<typeof installMediaDevices>;
let mic: FakeTrack;

beforeEach(() => {
  Object.defineProperty(window.screen, "width", { value: 1440, configurable: true });
  Object.defineProperty(window.screen, "height", { value: 900, configurable: true });
  media = installMediaDevices();
  mic = Object.assign(fakeTrack(), { kind: "audio" }) as unknown as FakeTrack;
  media.getUserMedia.mockImplementation(async (c) => ((c as MediaStreamConstraints).audio ? audioStream(mic) : fakeStream(fakeTrack())));
  fetchMock.mockClear();
  audioMonitors.length = 0;
  gazeMonitors.length = 0;
  gazeResult.value = "ok";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SystemCheck microphone", () => {
  it("asks for the microphone, listens for speech and keeps the stream", async () => {
    const { SystemCheck, heldMicrophone } = await load();
    render(<SystemCheck token="tok" proctoring={{ ...OFF, microphone: true }} consented />);
    await waitFor(() => expect(row("Microphone")).toHaveTextContent("Allowed"));
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.anything(), video: false }));
    expect(heldMicrophone()).toBeDefined();
    expect(row("Sound check")).toHaveTextContent("Say a few words");
    expect(continueLink()).not.toBeInTheDocument();

    await waitFor(() => expect(audioMonitors).toHaveLength(1));
    expect(audioMonitors[0].start).toHaveBeenCalled();
    act(() => audioMonitors[0].opts.onSignal("speech_started"));
    await waitFor(() => expect(row("Sound check")).toHaveTextContent("We heard you"));
    expect(audioMonitors[0].stop).toHaveBeenCalled();
    expect(continueLink()).toHaveAttribute("href", "/a/tok/instructions");
    await waitFor(() => expect(signalKinds()).toContain("microphone_started"));
  });

  it("lets the candidate continue after 10 seconds even if nothing was heard", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const { SystemCheck } = await load();
    render(<SystemCheck token="tok" proctoring={{ ...OFF, microphone: true }} consented />);
    await waitFor(() => expect(audioMonitors).toHaveLength(1));
    expect(continueLink()).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(row("Sound check")).toHaveTextContent("We didn't hear anything");
    expect(continueLink()).toBeInTheDocument();
  });

  it("explains a blocked microphone, records it and lets the candidate try again", async () => {
    media.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const { SystemCheck } = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="tok" proctoring={{ ...OFF, microphone: true }} consented />);
    await waitFor(() => expect(row("Microphone")).toHaveTextContent("Microphone access was blocked."));
    await waitFor(() => expect(signalKinds()).toContain("microphone_refused"));
    await user.click(screen.getByRole("button", { name: "Turn on microphone" }));
    await waitFor(() => expect(row("Microphone")).toHaveTextContent("Allowed"));
  });

  it("waits for consent before asking for the microphone", async () => {
    const { SystemCheck } = await load();
    render(<SystemCheck token="tok" proctoring={{ ...OFF, microphone: true }} />);
    expect(row("Microphone")).toHaveTextContent("Waiting for your agreement");
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("SystemCheck gaze warm-up", () => {
  it("runs a trial start and stop on the camera without a note when it works", async () => {
    const { SystemCheck } = await load();
    render(<SystemCheck token="tok" proctoring={{ ...OFF, camera: true, gaze: true }} consented />);
    await waitFor(() => expect(gazeMonitors).toHaveLength(1));
    await waitFor(() => expect(gazeMonitors[0].stop).toHaveBeenCalled());
    expect(gazeMonitors[0].start).toHaveBeenCalled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows a non-blocking note early when the device can't run it", async () => {
    gazeResult.value = "unsupported";
    const { SystemCheck } = await load();
    render(<SystemCheck token="tok" proctoring={{ ...OFF, camera: true, gaze: true }} consented />);
    expect(await screen.findByRole("note")).toHaveTextContent("Your device couldn't run the facing-the-screen check; your camera is still on.");
  });
});
