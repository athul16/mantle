/**
 * System check with proctoring on. Consent is normally recorded on the verify
 * page (`consented`); the camera then starts by itself, the start photo is an
 * explicit button, and an entire-screen share is required. Without recorded
 * consent the notice and an agree box come first. getUserMedia and
 * getDisplayMedia are faked; snapshot uploads are mocked.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domError, fakeStream, fakeTrack, installMediaDevices } from "./fake-media";

vi.mock("@/lib/proctoring/client/snapshots", () => ({ takeSnapshot: vi.fn(async () => true) }));
const { takeSnapshot } = await import("@/lib/proctoring/client/snapshots");

async function load() {
  vi.resetModules();
  return (await import("@/app/a/[token]/check/system-check")).SystemCheck;
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response);
const bodiesTo = (url: string) =>
  fetchMock.mock.calls.filter(([u]) => u === url).map(([, init]) => JSON.parse((init as RequestInit).body as string));
const row = (label: string) => screen.getAllByRole("listitem").find((li) => li.querySelector(".strong")?.textContent === label)!;
const continueLink = () => screen.queryByRole("link", { name: "Continue" });
const both = { camera: true, screen: true, fullscreen: false, microphone: false, gaze: false};
let media: ReturnType<typeof installMediaDevices>;

beforeEach(() => {
  Object.defineProperty(window.screen, "width", { value: 1440, configurable: true });
  Object.defineProperty(window.screen, "height", { value: 900, configurable: true });
  media = installMediaDevices();
  fetchMock.mockClear();
  vi.mocked(takeSnapshot).mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("SystemCheck without recorded consent", () => {
  it("explains what is captured, why and for how long before asking for anything", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={both} />);
    const consent = screen.getByRole("region", { name: "Monitoring for this test" });
    expect(consent).toHaveTextContent(/camera photo every 30 to 60 seconds/i);
    expect(consent).toHaveTextContent(/screenshot of your entire screen/i);
    expect(consent).toHaveTextContent(/No one is rejected automatically/i);
    expect(consent).toHaveTextContent(/deleted/i);
    expect(screen.getByRole("button", { name: "Share entire screen" })).toBeDisabled();
    expect(continueLink()).not.toBeInTheDocument();
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("names the microphone in the agree label when it is on", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={{ ...both, microphone: true }} />);
    expect(screen.getByRole("checkbox", { name: /I agree to camera, screen and microphone monitoring/ })).toBeVisible();
  });

  it("records consent, then starts the camera", async () => {
    media.getUserMedia.mockResolvedValue(fakeStream(fakeTrack()));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={both} />);
    await user.click(screen.getByRole("checkbox", { name: /I agree to camera and screen monitoring/ }));
    await waitFor(() => expect(bodiesTo("/api/candidate/proctoring/consent")).toEqual([{ agree: true }]));
    await waitFor(() => expect(row("Camera")).toHaveTextContent("Allowed"));
  });
});

describe("SystemCheck with consent from the verify page", () => {
  it("starts the camera, takes a start photo on request and requires an entire-screen share", async () => {
    const camera = fakeTrack();
    const shared = fakeTrack({ displaySurface: "monitor" });
    media.getUserMedia.mockResolvedValue(fakeStream(camera));
    media.getDisplayMedia.mockResolvedValue(fakeStream(shared));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="tok" proctoring={both} consented />);

    expect(screen.queryByRole("region", { name: "Monitoring for this test" })).not.toBeInTheDocument();
    await waitFor(() => expect(row("Camera")).toHaveTextContent("Allowed"));
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything(), audio: false }));
    expect(screen.getByLabelText("Camera preview")).toBeInTheDocument();
    expect(takeSnapshot).not.toHaveBeenCalled();
    expect(row("Start photo")).toHaveTextContent("Not taken yet");

    await user.click(screen.getByRole("button", { name: "Take start photo" }));
    await waitFor(() => expect(row("Start photo")).toHaveTextContent("Taken"));
    expect(takeSnapshot).toHaveBeenCalledWith("camera", expect.anything(), "start");
    expect(continueLink()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(row("Screen sharing")).toHaveTextContent("Entire screen shared"));
    expect(media.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ displaySurface: "monitor" }) }));
    expect(continueLink()).toHaveAttribute("href", "/a/tok/instructions");
  });

  it("says when the start photo couldn't be saved", async () => {
    media.getUserMedia.mockResolvedValue(fakeStream(fakeTrack()));
    vi.mocked(takeSnapshot).mockResolvedValueOnce(false);
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: true, screen: false, fullscreen: false, microphone: false, gaze: false}} consented />);
    await user.click(await screen.findByRole("button", { name: "Take start photo" }));
    await waitFor(() => expect(row("Start photo")).toHaveTextContent("Couldn't save it. Take it again."));
    expect(continueLink()).not.toBeInTheDocument();
  });

  it("explains a blocked camera and lets the candidate try again", async () => {
    media.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: true, screen: false, fullscreen: false, microphone: false, gaze: false}} consented />);
    await waitFor(() => expect(row("Camera")).toHaveTextContent(/blocked/i));
    expect(screen.getByText("Your browser blocked the camera")).toBeVisible();
    expect(bodiesTo("/api/candidate/proctoring/signals").flatMap((b) => b.signals.map((s: { kind: string }) => s.kind))).toContain("camera_refused");

    media.getUserMedia.mockResolvedValueOnce(fakeStream(fakeTrack()));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row("Camera")).toHaveTextContent("Allowed"));
  });

  it("says when there is no camera", async () => {
    media.getUserMedia.mockRejectedValueOnce(domError("NotFoundError"));
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={{ camera: true, screen: false, fullscreen: false, microphone: false, gaze: false}} consented />);
    await waitFor(() => expect(row("Camera")).toHaveTextContent("No camera found. Connect one and try again."));
  });

  it("rejects sharing a window or tab, stops that share and records it", async () => {
    const tab = fakeTrack({ displaySurface: "browser" });
    media.getDisplayMedia.mockResolvedValueOnce(fakeStream(tab));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: true, fullscreen: false, microphone: false, gaze: false}} consented />);
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(row("Screen sharing")).toHaveTextContent("You shared a window or tab"));
    expect(screen.getByRole("button", { name: "Share again" })).toBeEnabled();
    expect(tab.stop).toHaveBeenCalled();
    await waitFor(() =>
      expect(bodiesTo("/api/candidate/proctoring/signals").flatMap((b) => b.signals)).toContainEqual(
        expect.objectContaining({ kind: "screen_share_wrong_surface", surface: "browser" }),
      ),
    );
    expect(continueLink()).not.toBeInTheDocument();
  });

  it("explains a cancelled screen share", async () => {
    media.getDisplayMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: true, fullscreen: false, microphone: false, gaze: false}} consented />);
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    expect(await screen.findByText("Screen sharing was cancelled. You need to share your entire screen to take this test.")).toBeVisible();
  });

  it("says when the browser cannot share the screen at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: media.getUserMedia }, configurable: true });
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: true, fullscreen: false, microphone: false, gaze: false}} consented />);
    expect(row("Screen sharing")).toHaveTextContent("Not supported in this browser");
    expect(screen.getByText("This browser can't share your screen. Use a recent Chrome, Edge or Firefox on a computer.")).toBeVisible();
  });
});
