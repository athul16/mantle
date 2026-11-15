/**
 * Voice activity detection for the microphone monitor. Pure: no Web Audio
 * here, only numbers in and events out, so every threshold is unit-tested.
 *
 * It only answers "is someone speaking right now?". It never transcribes,
 * never tells voices apart and never decides anything about the candidate;
 * a person reviews the clips. See docs/02-security-and-integrity.md.
 */

/** One analysis frame: level and how much of the energy is in the speech band. */
export type VadFrame = { rms: number; speechBandRatio: number };
/** "start" when speech has lasted SPEECH_MIN_MS; { stop: speechMs } SPEECH_END_MS after it ends. */
export type VadEvent = "start" | { stop: number };

/** Speech when the level is this many times the noise floor (≈ 9.5 dB above it). */
export const SPEECH_FLOOR_RATIO = 3;
/** ...and above this absolute level (RMS of samples in -1..1, ≈ -40 dBFS), so a silent room doesn't make breathing "speech". */
export const MIN_SPEECH_RMS = 0.01;
/** ...and at least this share of the energy lies in SPEECH_BAND_HZ (rules out hum, rumble and hiss). */
export const MIN_SPEECH_BAND_RATIO = 0.5;
/** Telephone speech band, in Hz: where most of the energy of a voice is. */
export const SPEECH_BAND_HZ = [300, 3_400] as const;
/** Speech-like frames must continue this long before "start"; shorter blips (a cough, a click, a door) are ignored. */
export const SPEECH_MIN_MS = 300;
/** Speech ends after this long without a speech-like frame; shorter pauses between words keep one span. */
export const SPEECH_END_MS = 800;
/** Noise floor before any frame is seen (a quiet room). */
export const INITIAL_NOISE_FLOOR = 0.002;
/** The floor never drops below this, so the ratio test stays meaningful in digital silence. */
export const MIN_NOISE_FLOOR = 0.00001;
/**
 * Time constant of the floor for quiet frames (at most SPEECH_FLOOR_RATIO ×
 * the floor): it follows small changes in the room within a few seconds.
 */
export const QUIET_FLOOR_TAU_MS = 3_000;
/**
 * Time constant for loud frames that aren't speech-like (outside the speech
 * band, or under MIN_SPEECH_RMS): a new steady noise (a fan switched on) is
 * learned within seconds, while a short loud bang barely moves the floor.
 */
export const NOISE_FLOOR_TAU_MS = 15_000;
/**
 * Time constant of the floor for speech-like frames: it creeps up so slowly
 * that real speech (with its pauses) barely moves it, but a steady sound in
 * the speech band (a radio, a hum) stops counting as speech after ~20 s.
 */
export const LOUD_FLOOR_TAU_MS = 60_000;

export type VadOptions = {
  floorRatio?: number;
  minRms?: number;
  minBandRatio?: number;
  minSpeechMs?: number;
  endMs?: number;
  initialFloor?: number;
  quietTauMs?: number;
  loudTauMs?: number;
  noiseTauMs?: number;
};

export type Vad = {
  /** Feed one frame at time nowMs (monotonic, ms). Returns the events it caused, usually none. */
  update(frame: VadFrame, nowMs: number): VadEvent[];
  /** Closes an open speech span (on stop); returns its stop event, or nothing. */
  end(): VadEvent[];
  readonly speaking: boolean;
  readonly noiseFloor: number;
};

export function createVad(opts: VadOptions = {}): Vad {
  const floorRatio = opts.floorRatio ?? SPEECH_FLOOR_RATIO;
  const minRms = opts.minRms ?? MIN_SPEECH_RMS;
  const minBandRatio = opts.minBandRatio ?? MIN_SPEECH_BAND_RATIO;
  const minSpeechMs = opts.minSpeechMs ?? SPEECH_MIN_MS;
  const endMs = opts.endMs ?? SPEECH_END_MS;
  const quietTauMs = opts.quietTauMs ?? QUIET_FLOOR_TAU_MS;
  const loudTauMs = opts.loudTauMs ?? LOUD_FLOOR_TAU_MS;
  const noiseTauMs = opts.noiseTauMs ?? NOISE_FLOOR_TAU_MS;

  let floor = opts.initialFloor ?? INITIAL_NOISE_FLOOR;
  let lastNow: number | null = null;
  /** Start of the current run of speech-like frames (before "start"). */
  let onsetAt: number | null = null;
  let speaking = false;
  let spanStart = 0;
  let lastSpeechAt = 0;

  const closeSpan = (): VadEvent[] => {
    if (!speaking) return [];
    speaking = false;
    onsetAt = null;
    return [{ stop: lastSpeechAt - spanStart }];
  };

  return {
    update(frame, nowMs) {
      const dt = lastNow === null ? 0 : Math.min(Math.max(nowMs - lastNow, 0), 1_000);
      lastNow = nowMs;
      const quiet = frame.rms <= floor * floorRatio;
      const speechLike = !quiet && frame.rms > minRms && frame.speechBandRatio >= minBandRatio;

      // Adaptive noise floor: a slow EMA, slower for loud noise and much slower for speech-like frames.
      const tau = quiet ? quietTauMs : speechLike ? loudTauMs : noiseTauMs;
      const alpha = 1 - Math.exp(-dt / tau);
      floor = Math.max(MIN_NOISE_FLOOR, floor + alpha * (frame.rms - floor));

      const events: VadEvent[] = [];
      if (speaking) {
        if (speechLike) lastSpeechAt = nowMs;
        else if (nowMs - lastSpeechAt >= endMs) events.push(...closeSpan());
        return events;
      }
      if (!speechLike) {
        onsetAt = null;
        return events;
      }
      onsetAt ??= nowMs;
      if (nowMs - onsetAt >= minSpeechMs) {
        speaking = true;
        spanStart = onsetAt;
        lastSpeechAt = nowMs;
        events.push("start");
      }
      return events;
    },
    end: closeSpan,
    get speaking() {
      return speaking;
    },
    get noiseFloor() {
      return floor;
    },
  };
}

/**
 * Frame features from an AnalyserNode: RMS of getFloatTimeDomainData() and
 * the share of getFloatFrequencyData() power (dB per bin) that lies in
 * SPEECH_BAND_HZ. The DC bin is left out of the total.
 */
export function frameFeatures(timeDomain: Float32Array, frequencyDb: Float32Array, sampleRate: number): VadFrame {
  let sum = 0;
  for (let i = 0; i < timeDomain.length; i++) sum += timeDomain[i] * timeDomain[i];
  const rms = timeDomain.length ? Math.sqrt(sum / timeDomain.length) : 0;

  const binHz = sampleRate / (frequencyDb.length * 2);
  const [lo, hi] = SPEECH_BAND_HZ;
  let total = 0;
  let band = 0;
  for (let i = 1; i < frequencyDb.length; i++) {
    const db = frequencyDb[i];
    if (!Number.isFinite(db)) continue;
    const power = 10 ** (db / 10);
    total += power;
    const hz = i * binHz;
    if (hz >= lo && hz <= hi) band += power;
  }
  return { rms, speechBandRatio: total > 0 ? band / total : 0 };
}
