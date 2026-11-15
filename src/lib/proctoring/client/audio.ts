"use client";

import { AUDIO_CLIP_MAX_MS, audioMimeType } from "../config";
import { uploadMedia } from "./snapshots";
import { createVad, frameFeatures, type VadOptions } from "./vad";

/**
 * Microphone monitor: listens for speech on the device and records short
 * clips only while someone is speaking, never continuously. Clips go from the
 * browser straight to storage through uploadMedia's signed URLs, never through
 * our API. Nothing is transcribed and voices are never identified; a person
 * listens to the clips. See docs/02-security-and-integrity.md.
 *
 * Pipeline: MediaStream → AudioContext source → AnalyserNode (fftSize 2048,
 * not connected to the speakers) → every AUDIO_FRAME_MS one frame of level and
 * speech-band share → VAD (vad.ts) → a fresh MediaRecorder per clip.
 *
 * Hidden tabs: the AudioContext keeps running when the candidate switches
 * tabs, but main-thread timers are throttled there (Chrome: to once a second,
 * and to once a minute after 5 minutes hidden). Frames are therefore paced by
 * the dedicated-worker timer also used for away captures
 * (capture-timer.worker.ts), whose timers aren't throttled; reading the
 * analyser on its message is. Where there is no Worker, setInterval is used:
 * in a throttled tab that gives one frame a second, which still detects speech
 * that lasts two frames, just with coarser start and stop times.
 *
 * Known limit: recording starts when the VAD has heard SPEECH_MIN_MS of
 * speech, so each span's first ~300 ms isn't in the clip. Keeping a pre-roll
 * would mean recording all the time, which we don't.
 */

/** How often a frame is read from the analyser. */
export const AUDIO_FRAME_MS = 50;
/** Recorder types in order of preference (Chrome/Firefox, Firefox, Safari). */
export const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"] as const;
/** Default cap of uploaded clips per monitor; speech is still signalled after it. */
export const MAX_AUDIO_CLIPS = 120;

export type AudioSignalKind = "speech_started" | "speech_stopped" | "microphone_stopped";

export type AudioMonitorOptions = {
  /** The microphone stream from openMicrophone(). */
  stream: MediaStream;
  /** speech_started, speech_stopped (with speechMs) and microphone_stopped (the track ended). */
  onSignal: (kind: AudioSignalKind, payload?: { speechMs: number }) => void;
  upload?: typeof uploadMedia;
  maxClips?: number;
  vad?: VadOptions;
  /** Monotonic clock in ms (tests). */
  now?: () => number;
};

export type AudioMonitor = { start(): void; stop(): Promise<void> };

type Ticker = { stop(): void };

/** Calls fn every ms, from a worker timer when possible (see the note above). */
function startTicker(ms: number, fn: () => void): Ticker {
  if (typeof Worker !== "undefined") {
    try {
      const worker = new Worker(new URL("./capture-timer.worker.ts", import.meta.url));
      let running = true;
      const arm = () => worker.postMessage({ type: "set", id: 1, ms });
      worker.onmessage = () => {
        if (!running) return;
        arm();
        fn();
      };
      arm();
      return {
        stop() {
          running = false;
          worker.postMessage({ type: "clear", id: 1 });
          worker.terminate();
        },
      };
    } catch {
      // fall through to setInterval
    }
  }
  const id = setInterval(fn, ms);
  return { stop: () => clearInterval(id) };
}

function audioContextCtor(): (new () => AudioContext) | null {
  const g = globalThis as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return typeof Ctor === "function" ? Ctor : null;
}

/** First recorder type this browser supports, or null when it can't record audio. */
function recorderMimeType(): string | null {
  if (typeof MediaRecorder !== "function" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  return RECORDER_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function createAudioMonitor(opts: AudioMonitorOptions): AudioMonitor {
  const { stream, onSignal } = opts;
  const upload = opts.upload ?? uploadMedia;
  const maxClips = opts.maxClips ?? MAX_AUDIO_CLIPS;
  const now = opts.now ?? (() => performance.now());

  const vad = createVad(opts.vad);
  const pending = new Set<Promise<unknown>>();
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let ticker: Ticker | null = null;
  let started = false;
  /** Listening has ended (stop() or the track ended); no more frames or signals. */
  let halted = false;
  let stopped = false;
  let clips = 0;
  let recorder: { rec: MediaRecorder; startedAt: number; done: Promise<Blob[]> } | null = null;
  const mimeType = recorderMimeType();
  const track = stream.getAudioTracks()[0];

  function startClip() {
    if (!mimeType || clips >= maxClips) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType });
    } catch {
      return;
    }
    const chunks: Blob[] = [];
    const done = new Promise<Blob[]>((resolve) => {
      rec.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      rec.onstop = () => resolve(chunks);
      rec.onerror = () => resolve(chunks);
    });
    try {
      rec.start();
    } catch {
      return;
    }
    clips++;
    recorder = { rec, startedAt: now(), done };
  }

  function stopClip() {
    if (!recorder) return;
    const { rec, done } = recorder;
    recorder = null;
    const contentType = audioMimeType(rec.mimeType) ?? audioMimeType(mimeType);
    try {
      rec.stop();
    } catch {
      return;
    }
    const task = done
      .then(async (chunks) => {
        const blob = new Blob(chunks, { type: contentType ?? undefined });
        if (!contentType || !blob.size) return;
        await upload({ source: "audio", blob, contentType, reason: "speech" });
      })
      .catch(() => {});
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  function handle(events: ReturnType<typeof vad.update>) {
    for (const e of events) {
      if (e === "start") {
        onSignal("speech_started");
        startClip();
      } else {
        stopClip();
        onSignal("speech_stopped", { speechMs: Math.round(e.stop) });
      }
    }
  }

  const frame = (() => {
    let time: Float32Array<ArrayBuffer> | null = null;
    let freq: Float32Array<ArrayBuffer> | null = null;
    let analyser: AnalyserNode | null = null;
    return {
      attach(a: AnalyserNode) {
        analyser = a;
        time = new Float32Array(a.fftSize);
        freq = new Float32Array(a.frequencyBinCount);
      },
      read() {
        if (!analyser || !time || !freq || !ctx) return null;
        analyser.getFloatTimeDomainData(time);
        analyser.getFloatFrequencyData(freq);
        return frameFeatures(time, freq, ctx.sampleRate);
      },
    };
  })();

  function tick() {
    if (halted) return;
    const f = frame.read();
    if (!f) return;
    const t = now();
    handle(vad.update(f, t));
    // Long speech: close the clip at AUDIO_CLIP_MAX_MS and start the next one.
    if (recorder && t - recorder.startedAt >= AUDIO_CLIP_MAX_MS) {
      stopClip();
      if (vad.speaking) startClip();
    }
  }

  /** Stops listening and closes any open span (its clip and speech_stopped). */
  function halt() {
    if (halted) return;
    halted = true;
    ticker?.stop();
    ticker = null;
    track?.removeEventListener("ended", onEnded);
    handle(vad.end());
    stopClip();
  }

  function onEnded() {
    if (halted) return;
    halt();
    onSignal("microphone_stopped");
  }

  return {
    start() {
      if (started || halted) return;
      started = true;
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      try {
        ctx = new Ctor();
        source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser); // never to ctx.destination: nothing is played back
        frame.attach(analyser);
      } catch {
        void ctx?.close().catch(() => {});
        ctx = null;
        return;
      }
      // A context made outside a user gesture may start suspended.
      void ctx.resume?.().catch(() => {});
      track?.addEventListener("ended", onEnded);
      ticker = startTicker(AUDIO_FRAME_MS, tick);
    },
    async stop() {
      halt();
      if (stopped) return;
      stopped = true;
      await Promise.all([...pending]);
      try {
        source?.disconnect();
      } catch {
        // already disconnected
      }
      await ctx?.close().catch(() => {});
    },
  };
}
