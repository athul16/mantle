import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAwayCapture, MAX_AWAY_CAPTURES } from "@/lib/proctoring/client/away-capture";
import { uploadMedia } from "@/lib/proctoring/client/snapshots";
import { AWAY_CAPTURE_INTERVAL_MS } from "@/lib/proctoring/config";

const stream = (state: "live" | "ended" = "live") => ({ getVideoTracks: () => [{ readyState: state }] }) as unknown as MediaStream;

function setup(streams: { screen?: MediaStream; camera?: MediaStream } = { screen: stream(), camera: stream() }) {
  const capture = vi.fn().mockResolvedValue(true);
  const away = createAwayCapture({ getStream: (s) => streams[s], capture });
  return { capture, away };
}

describe("createAwayCapture", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("captures screen and camera at 2 s and 6 s, then every 10 s", () => {
    const { capture, away } = setup();
    away.left();
    vi.advanceTimersByTime(1_999);
    expect(capture).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(capture.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["screen", "away"],
      ["camera", "away"],
    ]);
    vi.advanceTimersByTime(4_000);
    expect(capture).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(AWAY_CAPTURE_INTERVAL_MS - 1);
    expect(capture).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1);
    expect(capture).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(AWAY_CAPTURE_INTERVAL_MS);
    expect(capture).toHaveBeenCalledTimes(8);
    away.stop();
  });

  it("stops after the cap", () => {
    const { capture, away } = setup();
    away.left();
    vi.advanceTimersByTime(10_000_000);
    expect(capture).toHaveBeenCalledTimes(MAX_AWAY_CAPTURES * 2);
    away.stop();
  });

  it("returned cancels the schedule and takes one 'returned' capture", () => {
    const { capture, away } = setup();
    away.left();
    vi.advanceTimersByTime(2_000);
    capture.mockClear();
    away.returned();
    expect(capture.mock.calls.map((c) => c[2])).toEqual(["returned", "returned"]);
    vi.advanceTimersByTime(60_000);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("returned without leaving does nothing", () => {
    const { capture, away } = setup();
    away.returned();
    expect(capture).not.toHaveBeenCalled();
  });

  it("left twice does not double-schedule", () => {
    const { capture, away } = setup();
    away.left();
    away.left();
    vi.advanceTimersByTime(2_000);
    expect(capture).toHaveBeenCalledTimes(2);
    away.stop();
  });

  it("can start a new absence after returning", () => {
    const { capture, away } = setup();
    away.left();
    away.returned();
    capture.mockClear();
    away.left();
    vi.advanceTimersByTime(2_000);
    expect(capture).toHaveBeenCalledTimes(2);
    away.stop();
  });

  it("stop cleans everything up", () => {
    const { capture, away } = setup();
    away.left();
    away.stop();
    vi.advanceTimersByTime(60_000);
    expect(capture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    away.returned();
    expect(capture).not.toHaveBeenCalled();
  });

  it("skips missing and ended streams", () => {
    const { capture, away } = setup({ screen: stream(), camera: stream("ended") });
    away.left();
    vi.advanceTimersByTime(2_000);
    expect(capture.mock.calls.map((c) => c[0])).toEqual(["screen"]);
    away.stop();
    const none = setup({});
    none.away.left();
    vi.advanceTimersByTime(10_000);
    expect(none.capture).not.toHaveBeenCalled();
    none.away.stop();
  });

  it("survives a failing capture", () => {
    const capture = vi.fn().mockRejectedValue(new Error("x"));
    const away = createAwayCapture({ getStream: () => stream(), capture });
    away.left();
    vi.advanceTimersByTime(8_000);
    expect(capture).toHaveBeenCalledTimes(4);
    away.stop();
  });
});

describe("uploadMedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the reason and content type, uploads with that type, then registers the media", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/proctoring/upload") ? { ok: true, json: async () => ({ path: "org/att/audio/a b.webm", token: "t" }) } : { ok: true },
    );
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["x"], { type: "audio/webm" });
    expect(await uploadMedia({ source: "audio", blob, contentType: "audio/webm", reason: "speech" })).toBe(true);
    const [first, put, last] = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(first[1].body as string)).toEqual({ source: "audio", reason: "speech", contentType: "audio/webm" });
    expect(put[0]).toContain("/upload/sign/proctoring/org/att/audio/a%20b.webm?token=t");
    expect((put[1].headers as Record<string, string>)["content-type"]).toBe("audio/webm");
    expect(last[0]).toBe("/api/candidate/proctoring/media");
    expect(JSON.parse(last[1].body as string)).toEqual({ path: "org/att/audio/a b.webm", reason: "speech" });
  });

  it("returns false when the upload route refuses or fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const blob = new Blob(["x"]);
    expect(await uploadMedia({ source: "screen", blob, contentType: "image/jpeg" })).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net");
      }),
    );
    expect(await uploadMedia({ source: "screen", blob, contentType: "image/jpeg" })).toBe(false);
  });
});
