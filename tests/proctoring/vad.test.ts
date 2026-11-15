import { describe, expect, it } from "vitest";
import {
  createVad,
  frameFeatures,
  INITIAL_NOISE_FLOOR,
  MIN_SPEECH_RMS,
  SPEECH_BAND_HZ,
  SPEECH_END_MS,
  SPEECH_MIN_MS,
  type VadEvent,
} from "@/lib/proctoring/client/vad";

const STEP = 50;
const quiet = { rms: 0.002, speechBandRatio: 0.2 };
const voice = { rms: 0.1, speechBandRatio: 0.8 };

/** Feeds `frame` every 50 ms from `from` (inclusive) to `to` (exclusive); returns events with their times. */
function feed(vad: ReturnType<typeof createVad>, frame: { rms: number; speechBandRatio: number }, from: number, to: number) {
  const out: [number, VadEvent][] = [];
  for (let t = from; t < to; t += STEP) for (const e of vad.update(frame, t)) out.push([t, e]);
  return out;
}

describe("createVad", () => {
  it("starts after 300 ms of speech and stops 800 ms after it ends, with the speech length", () => {
    const vad = createVad();
    expect(feed(vad, quiet, 0, 1_000)).toEqual([]);
    // speech frames at 1000..2950
    const started = feed(vad, voice, 1_000, 3_000);
    expect(started).toEqual([[1_000 + SPEECH_MIN_MS, "start"]]);
    expect(vad.speaking).toBe(true);
    const stopped = feed(vad, quiet, 3_000, 5_000);
    // last speech frame at 2950; quiet for 800 ms → stop at 3750
    expect(stopped).toEqual([[2_950 + SPEECH_END_MS, { stop: 1_950 }]]);
    expect(vad.speaking).toBe(false);
  });

  it("ignores blips shorter than 300 ms", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    for (let i = 0; i < 5; i++) {
      expect(feed(vad, voice, 1_000 + i * 1_000, 1_250 + i * 1_000)).toEqual([]); // 5 frames = 200 ms
      expect(feed(vad, quiet, 1_250 + i * 1_000, 2_000 + i * 1_000)).toEqual([]);
    }
    expect(vad.speaking).toBe(false);
  });

  it("needs the speech to be continuous for the whole 300 ms", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    expect(feed(vad, voice, 1_000, 1_250)).toEqual([]);
    expect(feed(vad, quiet, 1_250, 1_300)).toEqual([]);
    expect(feed(vad, voice, 1_300, 1_550)).toEqual([]);
    expect(feed(vad, voice, 1_550, 1_700)).toEqual([[1_600, "start"]]);
  });

  it("keeps one span through pauses shorter than 800 ms", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    const events = [
      ...feed(vad, voice, 1_000, 2_000),
      ...feed(vad, quiet, 2_000, 2_700), // 700 ms pause
      ...feed(vad, voice, 2_700, 3_500),
      ...feed(vad, quiet, 3_500, 5_000),
    ];
    expect(events).toEqual([
      [1_300, "start"],
      [3_450 + SPEECH_END_MS, { stop: 2_450 }],
    ]);
  });

  it("splits into two spans after a pause of 800 ms or more", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    const events = [...feed(vad, voice, 1_000, 2_000), ...feed(vad, quiet, 2_000, 3_000), ...feed(vad, voice, 3_000, 4_000), ...feed(vad, quiet, 4_000, 6_000)];
    expect(events.map(([, e]) => e)).toEqual(["start", { stop: 950 }, "start", { stop: 950 }]);
  });

  it("needs most of the energy in the 300–3400 Hz band", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    expect(feed(vad, { rms: 0.2, speechBandRatio: 0.49 }, 1_000, 3_000)).toEqual([]);
    expect(feed(vad, { rms: 0.2, speechBandRatio: 0.5 }, 3_000, 3_400)).toEqual([[3_300, "start"]]);
  });

  it("needs the level above three times the noise floor", () => {
    const vad = createVad();
    feed(vad, { rms: 0.01, speechBandRatio: 0.3 }, 0, 30_000); // room noise settles the floor near 0.01
    expect(vad.noiseFloor).toBeGreaterThan(0.009);
    expect(vad.noiseFloor).toBeLessThan(0.0101);
    expect(feed(vad, { rms: 0.028, speechBandRatio: 0.8 }, 30_000, 31_000)).toEqual([]);
    expect(feed(vad, { rms: 0.05, speechBandRatio: 0.8 }, 31_000, 31_400)).toEqual([[31_300, "start"]]);
  });

  it("needs the level above an absolute minimum in a silent room", () => {
    const vad = createVad();
    feed(vad, { rms: 0.0001, speechBandRatio: 0.3 }, 0, 30_000);
    expect(feed(vad, { rms: MIN_SPEECH_RMS * 0.9, speechBandRatio: 0.9 }, 30_000, 32_000)).toEqual([]);
    expect(feed(vad, { rms: MIN_SPEECH_RMS * 1.5, speechBandRatio: 0.9 }, 32_000, 32_400)).toEqual([[32_300, "start"]]);
  });

  it("tracks the floor slowly: a short loud burst barely moves it", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 10_000);
    const before = vad.noiseFloor;
    feed(vad, voice, 10_000, 11_000);
    expect(vad.noiseFloor).toBeLessThan(before + (voice.rms - before) * 0.05);
  });

  it("adapts to a steady new noise level so it doesn't count as speech forever", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 5_000);
    const hum = { rms: 0.05, speechBandRatio: 0.7 };
    const events = feed(vad, hum, 5_000, 120_000);
    expect(events[0]).toEqual([5_300, "start"]);
    expect(events).toHaveLength(2);
    expect(events[1][1]).toEqual({ stop: expect.any(Number) });
    expect(vad.speaking).toBe(false);
    expect(vad.noiseFloor).toBeGreaterThan(hum.rms / 3);
  });

  it("learns a new loud noise outside the speech band (a fan) within seconds, not a short bang", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 5_000);
    feed(vad, { rms: 0.3, speechBandRatio: 0.1 }, 5_000, 5_200);
    expect(vad.noiseFloor).toBeLessThan(0.01);
    feed(vad, { rms: 0.05, speechBandRatio: 0.2 }, 5_200, 30_000);
    expect(vad.noiseFloor).toBeGreaterThan(0.045);
  });

  it("starts from the initial floor and lets quiet frames pull it down", () => {
    const vad = createVad();
    expect(vad.noiseFloor).toBe(INITIAL_NOISE_FLOOR);
    feed(vad, { rms: 0.0005, speechBandRatio: 0.3 }, 0, 20_000);
    expect(vad.noiseFloor).toBeLessThan(0.0006);
  });

  it("accepts tunables", () => {
    const vad = createVad({ minSpeechMs: 100, endMs: 200 });
    feed(vad, quiet, 0, 500);
    const events = [...feed(vad, voice, 500, 700), ...feed(vad, quiet, 700, 1_200)];
    expect(events).toEqual([
      [600, "start"],
      [650 + 200, { stop: 150 }],
    ]);
  });

  it("end() closes an open span at the last speech frame", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    feed(vad, voice, 1_000, 2_000);
    expect(vad.end()).toEqual([{ stop: 950 }]);
    expect(vad.speaking).toBe(false);
    expect(vad.end()).toEqual([]);
  });

  it("handles a gap in frames longer than the hangover", () => {
    const vad = createVad();
    feed(vad, quiet, 0, 1_000);
    feed(vad, voice, 1_000, 2_000);
    expect(vad.update(quiet, 5_000)).toEqual([{ stop: 950 }]);
  });
});

describe("frameFeatures", () => {
  const sampleRate = 48_000;
  const fftSize = 2048;
  const bins = fftSize / 2;
  const binHz = sampleRate / fftSize;

  /** Spectrum in dB with `power` (linear) in the bins that `inBin(hz)` selects and silence elsewhere. */
  function spectrum(inBin: (hz: number) => boolean) {
    const db = new Float32Array(bins);
    for (let i = 0; i < bins; i++) db[i] = inBin(i * binHz) ? -20 : -Infinity;
    return db;
  }

  it("computes the RMS of the time-domain samples", () => {
    const time = new Float32Array(1024).map((_, i) => (i % 2 ? 0.5 : -0.5));
    expect(frameFeatures(time, spectrum(() => false), sampleRate).rms).toBeCloseTo(0.5);
  });

  it("is ~1 for energy only inside 300–3400 Hz and ~0 for energy only outside", () => {
    const time = new Float32Array(16);
    const inside = frameFeatures(time, spectrum((hz) => hz >= 500 && hz <= 3_000), sampleRate);
    expect(inside.speechBandRatio).toBeCloseTo(1);
    const outside = frameFeatures(time, spectrum((hz) => hz >= 5_000), sampleRate);
    expect(outside.speechBandRatio).toBeCloseTo(0);
  });

  it("splits energy between the band and the rest", () => {
    const [lo, hi] = SPEECH_BAND_HZ;
    const time = new Float32Array(16);
    const inBand = spectrum((hz) => hz >= lo && hz <= hi).filter((v) => v > -Infinity).length;
    const all = spectrum((hz) => hz >= 50).filter((v) => v > -Infinity).length;
    const r = frameFeatures(time, spectrum((hz) => hz >= 50), sampleRate).speechBandRatio;
    expect(r).toBeCloseTo(inBand / all, 2);
  });

  it("is 0 for silence", () => {
    expect(frameFeatures(new Float32Array(16), spectrum(() => false), sampleRate)).toEqual({ rms: 0, speechBandRatio: 0 });
  });
});
