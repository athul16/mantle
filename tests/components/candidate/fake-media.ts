/** Fake camera and screen-share streams for jsdom (not a test file). */
import { vi } from "vitest";

export type FakeTrack = {
  kind: "video";
  readyState: "live" | "ended";
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => { displaySurface?: string };
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  /** Simulate the browser ending the track (the "Stop sharing" bar, unplugged camera). */
  end: () => void;
};

export function fakeTrack(settings: { displaySurface?: string } = {}): FakeTrack {
  const listeners = new Map<string, Set<() => void>>();
  const track: FakeTrack = {
    kind: "video",
    readyState: "live",
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
    getSettings: () => settings,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    end: () => {
      track.readyState = "ended";
      for (const fn of listeners.get("ended") ?? []) fn();
    },
  };
  return track;
}

export function fakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

export function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

/** Installs navigator.mediaDevices with mock getUserMedia / getDisplayMedia. */
export function installMediaDevices() {
  const getUserMedia = vi.fn<(c: MediaStreamConstraints) => Promise<MediaStream>>();
  const getDisplayMedia = vi.fn<(c?: DisplayMediaStreamOptions) => Promise<MediaStream>>();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia, getDisplayMedia },
    configurable: true,
  });
  return { getUserMedia, getDisplayMedia };
}
