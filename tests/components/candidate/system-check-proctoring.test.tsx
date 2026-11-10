/**
 * System check with proctoring on: consent first, then a real camera check
 * (with a start photo) and a required entire-screen share. getUserMedia and
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
const row = (label: string) => screen.getByText(label, { selector: "li p" }).closest("li")!;
const both = { camera: true, screen: true };
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

async function agree(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: /I agree to camera and screen monitoring/ }));
  await waitFor(() => expect(bodiesTo("/api/candidate/proctoring/consent")).toEqual([{ agree: true }]));
}

describe("SystemCheck without proctoring", () => {
  it("says camera and screen share are not used and lets the candidate continue", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: false }} />);
    expect(row("Camera")).toHaveTextContent("Not used in this test.");
    expect(row("Screen share")).toHaveTextContent("Not used in this test.");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to instructions" })).toBeVisible();
  });
});

describe("SystemCheck with proctoring", () => {
  it("explains what is captured, why and for how long before asking for anything", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={both} />);
    const consent = screen.getByRole("region", { name: "Monitoring for this test" });
    expect(consent).toHaveTextContent(/camera photo every 30 to 60 seconds/i);
    expect(consent).toHaveTextContent(/screenshot of your entire screen/i);
    expect(consent).toHaveTextContent(/leave the test window, leave full screen, copy or paste/i);
    expect(consent).toHaveTextContent(/hiring team/i);
    expect(consent).toHaveTextContent(/No one is rejected automatically/i);
    expect(consent).toHaveTextContent(/deleted/i);
    expect(screen.getByRole("button", { name: "Test camera" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share entire screen" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Continue to instructions" })).not.toBeInTheDocument();
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("records consent, checks the camera, takes a start photo and requires an entire-screen share", async () => {
    const camera = fakeTrack();
    const shared = fakeTrack({ displaySurface: "monitor" });
    media.getUserMedia.mockResolvedValue(fakeStream(camera));
    media.getDisplayMedia.mockResolvedValue(fakeStream(shared));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="tok" proctoring={both} />);

    await agree(user);
    await user.click(screen.getByRole("button", { name: "Test camera" }));
    await waitFor(() => expect(row("Camera")).toHaveTextContent("OK"));
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything(), audio: false }));
    expect(screen.getByLabelText("Camera preview")).toBeInTheDocument();
    await waitFor(() => expect(takeSnapshot).toHaveBeenCalledWith("camera", expect.anything()));
    expect(screen.queryByRole("link", { name: "Continue to instructions" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(row("Screen share")).toHaveTextContent("OK"));
    expect(media.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ displaySurface: "monitor" }) }));
    expect(screen.getByRole("link", { name: "Continue to instructions" })).toHaveAttribute("href", "/a/tok/instructions");
  });

  it("starts with consent already given when the server has it", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" proctoring={both} consented />);
    expect(screen.getByRole("checkbox", { name: /I agree to camera and screen monitoring/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Test camera" })).toBeEnabled();
  });

  it("explains a blocked camera and lets the candidate try again", async () => {
    media.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: true, screen: false }} />);
    await agree(user);
    await user.click(screen.getByRole("button", { name: "Test camera" }));
    await waitFor(() => expect(row("Camera")).toHaveTextContent("Problem"));
    expect(row("Camera")).toHaveTextContent("Camera access was blocked. Allow it in your browser's site settings, then try again.");
    expect(bodiesTo("/api/candidate/proctoring/signals").flatMap((b) => b.signals.map((s: { kind: string }) => s.kind))).toContain("camera_refused");

    media.getUserMedia.mockResolvedValueOnce(fakeStream(fakeTrack()));
    await user.click(screen.getByRole("button", { name: "Try camera again" }));
    await waitFor(() => expect(row("Camera")).toHaveTextContent("OK"));
  });

  it("says when there is no camera", async () => {
    media.getUserMedia.mockRejectedValueOnce(domError("NotFoundError"));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: true, screen: false }} />);
    await agree(user);
    await user.click(screen.getByRole("button", { name: "Test camera" }));
    await waitFor(() => expect(row("Camera")).toHaveTextContent("No camera found. Connect one and try again."));
  });

  it("rejects sharing a window or tab, stops that share and records it", async () => {
    const tab = fakeTrack({ displaySurface: "browser" });
    media.getDisplayMedia.mockResolvedValueOnce(fakeStream(tab));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: true }} />);
    await agree(user);
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(row("Screen share")).toHaveTextContent("Problem"));
    expect(row("Screen share")).toHaveTextContent("You shared a window or tab. Choose “Entire screen” instead.");
    expect(tab.stop).toHaveBeenCalled();
    await waitFor(() =>
      expect(bodiesTo("/api/candidate/proctoring/signals").flatMap((b) => b.signals)).toContainEqual(
        expect.objectContaining({ kind: "screen_share_wrong_surface", surface: "browser" }),
      ),
    );
    expect(screen.queryByRole("link", { name: "Continue to instructions" })).not.toBeInTheDocument();
  });

  it("explains a cancelled screen share", async () => {
    media.getDisplayMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: true }} />);
    await agree(user);
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() =>
      expect(row("Screen share")).toHaveTextContent("Screen sharing was cancelled. You need to share your entire screen to take this test."),
    );
  });

  it("says when the browser cannot share the screen at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: media.getUserMedia }, configurable: true });
    const SystemCheck = await load();
    const user = userEvent.setup();
    render(<SystemCheck token="t" proctoring={{ camera: false, screen: true }} />);
    await agree(user);
    expect(row("Screen share")).toHaveTextContent("This browser can't share your screen. Use a recent Chrome, Edge or Firefox on a computer.");
  });
});
