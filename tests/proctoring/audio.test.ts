import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIO_FRAME_MS, createAudioMonitor, RECORDER_MIME_TYPES } from "@/lib/proctoring/client/audio";
import { AUDIO_CLIP_MAX_MS } from "@/lib/proctoring/config";

/** What the fake microphone hears right now. */
let level = { rms: 0.002, band: 0.2 };
const QUIET = { rms: 0.002, band: 0.2 };
const VOICE = { rms: 0.1, band: 0.8 };

const contexts: FakeAudioContext[] = [];
class FakeAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getFloatTimeDomainData(a: Float32Array) {
    for (let i = 0; i < a.length; i++) a[i] = i % 2 ? level.rms : -level.rms;
  }
  getFloatFrequencyData(a: Float32Array) {
    const binHz = 48_000 / (a.length * 2);
    const inBand = (i: number) => i * binHz >= 300 && i * binHz <= 3_400;
    let nIn = 0;
    for (let i = 1; i < a.length; i++) if (inBand(i)) nIn++;
    const nOut = a.length - 1 - nIn;
    a[0] = -Infinity;
    for (let i = 1; i < a.length; i++) a[i] = 10 * Math.log10(inBand(i) ? level.band / nIn : (1 - level.band) / nOut);
  }
}
class FakeAudioContext {
  sampleRate = 48_000;
  state = "running";
  analyser = new FakeAnalyser();
  source = { connect: vi.fn(), disconnect: vi.fn() };
  close = vi.fn(async () => {
    this.state = "closed";
  });
  resume = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createMediaStreamSource = vi.fn(() => this.source);
  createAnalyser = () => this.analyser;
}

const recorders: FakeRecorder[] = [];
let supported: string[] = [...RECORDER_MIME_TYPES];
class FakeRecorder {
  static isTypeSupported = (t: string) => supported.includes(t);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startedAt = 0;
  stoppedAt: number | null = null;
  constructor(
    public stream: unknown,
    opts: { mimeType: string },
  ) {
    this.mimeType = opts.mimeType;
    recorders.push(this);
  }
  start() {
    this.state = "recording";
    this.startedAt = Date.now();
  }
  stop() {
    this.state = "inactive";
    this.stoppedAt = Date.now();
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["clip"], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

function makeStream() {
  const track = Object.assign(new EventTarget(), { kind: "audio", readyState: "live" });
  return { stream: { getAudioTracks: () => [track] } as unknown as MediaStream, track };
}

function setup(opts: { maxClips?: number } = {}) {
  const { stream, track } = makeStream();
  const onSignal = vi.fn();
  const upload = vi.fn().mockResolvedValue(true);
  const monitor = createAudioMonitor({ stream, onSignal, upload, now: () => Date.now(), ...opts });
  return { stream, track, onSignal, upload, monitor };
}

async function hear(l: typeof level, ms: number) {
  level = l;
  await vi.advanceTimersByTimeAsync(ms);
}

describe("createAudioMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    contexts.length = 0;
    recorders.length = 0;
    supported = [...RECORDER_MIME_TYPES];
    level = QUIET;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("listens through an analyser with fftSize 2048 and never plays the sound", async () => {
    const { monitor, stream } = setup();
    monitor.start();
    const ctx = contexts[0];
    expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(ctx.analyser.fftSize).toBe(2048);
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(ctx.resume).toHaveBeenCalled();
    await monitor.stop();
  });

  it("records nothing while there is no speech", async () => {
    const { monitor, onSignal, upload } = setup();
    monitor.start();
    await hear(QUIET, 10_000);
    await hear({ rms: 0.3, band: 0.1 }, 200); // a bang outside the speech band
    await hear(VOICE, 200); // a blip shorter than 300 ms
    await hear(QUIET, 5_000);
    expect(recorders).toHaveLength(0);
    expect(onSignal).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    await monitor.stop();
  });

  it("records one clip per speech span and signals start and stop", async () => {
    const { monitor, onSignal, upload, stream } = setup();
    monitor.start();
    await hear(QUIET, 1_000);
    await hear(VOICE, 2_000);
    expect(onSignal.mock.calls).toEqual([["speech_started"]]);
    expect(recorders).toHaveLength(1);
    expect(recorders[0].stream).toBe(stream);
    expect(recorders[0].state).toBe("recording");
    await hear(QUIET, 2_000);
    expect(onSignal.mock.calls).toEqual([["speech_started"], ["speech_stopped", { speechMs: expect.any(Number) }]]);
    const speechMs = onSignal.mock.calls[1][1].speechMs;
    expect(speechMs).toBeGreaterThanOrEqual(1_900);
    expect(speechMs).toBeLessThanOrEqual(2_000);
    expect(recorders[0].state).toBe("inactive");
    expect(upload).toHaveBeenCalledTimes(1);
    const args = upload.mock.calls[0][0];
    expect(args).toMatchObject({ source: "audio", reason: "speech", contentType: "audio/webm" });
    expect(args.blob).toBeInstanceOf(Blob);
    expect(args.blob.size).toBeGreaterThan(0);
    await monitor.stop();
  });

  it("splits long speech into clips of at most 15 s", async () => {
    const { monitor, upload, onSignal } = setup();
    monitor.start();
    await hear(QUIET, 1_000);
    // 40 s of talking, with the short pauses between words that real speech has
    for (let i = 0; i < 40; i++) {
      await hear(VOICE, 850);
      await hear(QUIET, 150);
    }
    await hear(QUIET, 2_000);
    expect(recorders).toHaveLength(3);
    for (const r of recorders) expect(r.stoppedAt! - r.startedAt).toBeLessThanOrEqual(AUDIO_CLIP_MAX_MS + AUDIO_FRAME_MS);
    expect(recorders[0].stoppedAt! - recorders[0].startedAt).toBeGreaterThanOrEqual(AUDIO_CLIP_MAX_MS);
    expect(upload).toHaveBeenCalledTimes(3);
    // one span: one start and one stop signal
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(["speech_started", "speech_stopped"]);
    await monitor.stop();
  });

  it("caps uploaded clips but keeps signalling", async () => {
    const { monitor, upload, onSignal } = setup({ maxClips: 2 });
    monitor.start();
    await hear(QUIET, 1_000);
    for (let i = 0; i < 4; i++) {
      await hear(VOICE, 1_000);
      await hear(QUIET, 2_000);
    }
    expect(upload).toHaveBeenCalledTimes(2);
    expect(recorders).toHaveLength(2);
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(Array(4).fill(["speech_started", "speech_stopped"]).flat());
    await monitor.stop();
  });

  it("uses the first supported recorder type and uploads its base type", async () => {
    supported = ["audio/mp4"];
    const { monitor, upload } = setup();
    monitor.start();
    await hear(QUIET, 1_000);
    await hear(VOICE, 1_000);
    await hear(QUIET, 2_000);
    expect(recorders[0].mimeType).toBe("audio/mp4");
    expect(upload.mock.calls[0][0].contentType).toBe("audio/mp4");
    await monitor.stop();
  });

  it("still signals speech when the browser can't record audio", async () => {
    supported = [];
    const { monitor, upload, onSignal } = setup();
    monitor.start();
    await hear(QUIET, 1_000);
    await hear(VOICE, 1_000);
    await hear(QUIET, 2_000);
    expect(recorders).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(["speech_started", "speech_stopped"]);
    await monitor.stop();
  });

  it("stop() flushes the current clip, closes the span and the AudioContext", async () => {
    const { monitor, upload, onSignal } = setup();
    monitor.start();
    await hear(QUIET, 1_000);
    await hear(VOICE, 3_000);
    await monitor.stop();
    expect(recorders[0].state).toBe("inactive");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(["speech_started", "speech_stopped"]);
    expect(contexts[0].close).toHaveBeenCalled();
    await hear(VOICE, 5_000);
    expect(recorders).toHaveLength(1);
    expect(onSignal).toHaveBeenCalledTimes(2);
    await monitor.stop(); // idempotent
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
  });

  it("stop() waits for the clip upload to finish", async () => {
    const { stream } = makeStream();
    let finish!: (v: boolean) => void;
    const upload = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const monitor = createAudioMonitor({ stream, onSignal: vi.fn(), upload, now: () => Date.now() });
    monitor.start();
    await hear(QUIET, 1_000);
    await hear(VOICE, 1_000);
    let done = false;
    const stopping = monitor.stop().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    finish(true);
    await stopping;
    expect(done).toBe(true);
  });

  it("signals microphone_stopped when the track ends, closing any open span first", async () => {
    const { monitor, upload, onSignal, track } = setup();
    monitor.start();
    await hear(QUIET, 1_000);
    await hear(VOICE, 1_000);
    track.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(["speech_started", "speech_stopped", "microphone_stopped"]);
    expect(upload).toHaveBeenCalledTimes(1);
    await hear(VOICE, 5_000);
    expect(onSignal).toHaveBeenCalledTimes(3);
    await monitor.stop();
    expect(onSignal).toHaveBeenCalledTimes(3);
  });

  it("does nothing without Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { monitor, onSignal } = setup();
    monitor.start();
    await hear(VOICE, 2_000);
    expect(onSignal).not.toHaveBeenCalled();
    await monitor.stop();
  });
});
