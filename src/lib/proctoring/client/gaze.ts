"use client";

/**
 * On-device gaze and face-count check (assessments.proctoring.gaze).
 *
 * Runs MediaPipe FaceLandmarker in the browser on the camera stream, once per
 * sampleMs, and turns each frame into numbers only: how many faces, and the
 * head yaw/pitch of the main face. gaze-logic.ts debounces those into
 * signals. Privacy (pilot decisions D3/D7): frames, landmarks and matrices
 * never leave this module, nothing is stored, nobody is identified. Only the
 * signal kinds and their small payloads (direction, awayMs, faces) go to
 * onSignal.
 *
 * Assets are self-hosted under /mediapipe (wasm runtime copied from
 * node_modules/@mediapipe/tasks-vision/wasm, plus the float16
 * face_landmarker.task model), and the library itself is loaded with a
 * dynamic import, so assessments without gaze never download any of it.
 */

import type { FaceLandmarker, FaceLandmarkerResult, Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { createGazeState, type Emission, type GazeSample } from "./gaze-logic";

export type GazeSignalKind = Emission["kind"];
/** Payload per kind, as in SignalPayloadV2 (config.ts): direction, awayMs, faces, or nothing. */
export type GazeSignalPayload = Omit<Emission, "kind">;
export type GazeStartResult = "ok" | "unsupported" | "failed";

export interface GazeMonitorOptions {
  /** The live camera stream (the one already used for snapshots). Not stopped by stop(). */
  stream: MediaStream;
  onSignal: (kind: GazeSignalKind, payload: GazeSignalPayload) => void;
  /** How often a frame is checked. */
  sampleMs?: number;
  /** Where the wasm folder and model live (public/mediapipe). */
  assetBase?: string;
}

export interface GazeMonitor {
  /**
   * Loads the model and starts sampling. "unsupported": no WebAssembly, no
   * document or no live video track. "failed": the library, wasm or model
   * didn't load (network, GPU and CPU both refused), or stop() was called
   * while loading.
   */
  start(): Promise<GazeStartResult>;
  /** Stops sampling and frees the model. Safe to call more than once. */
  stop(): void;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Head angles from a forward vector in camera space (x right in the image,
 * y up, z towards the camera; a face looking straight at the camera has
 * forward (0, 0, 1)). The camera image is not mirrored, so a nose pointing
 * to image-right means the candidate turned to their own left: candidate
 * yaw (> 0 = their right) is -atan2(x, z). Pitch (> 0 = up) is the elevation
 * of the vector.
 */
export function anglesFromForward(x: number, y: number, z: number): { yawDeg: number; pitchDeg: number } {
  const yawDeg = -Math.atan2(x, z) * RAD_TO_DEG;
  const pitchDeg = Math.atan2(y, Math.hypot(x, z)) * RAD_TO_DEG;
  return { yawDeg: yawDeg + 0, pitchDeg: pitchDeg + 0 }; // + 0 turns -0 into 0
}

/**
 * Head yaw/pitch from the facial transformation matrix. The matrix is 4x4,
 * flattened column-major (MediaPipe MatrixData default), and maps the
 * canonical face model (x right, y up, z out of the face, i.e. forward is
 * (0, 0, 1)) into the camera's metric space (camera at the origin looking
 * down -z, y up). The face's forward direction is therefore R·(0, 0, 1),
 * the third column of the rotation block: (m[8], m[9], m[10]). Translation
 * and scale don't change the direction.
 */
export function anglesFromMatrix(matrix: Matrix): { yawDeg: number; pitchDeg: number } | null {
  const d = matrix?.data;
  if (!d || d.length < 16 || matrix.rows !== 4 || matrix.columns !== 4) return null;
  const [x, y, z] = [d[8], d[9], d[10]];
  if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) === 0) return null;
  return anglesFromForward(x, y, z);
}

// Face mesh landmark indices used by the geometry fallback.
const FOREHEAD = 10;
const CHIN = 152;
const EYE_OUTER_IMAGE_LEFT = 33;
const EYE_OUTER_IMAGE_RIGHT = 263;

/**
 * Fallback when no matrix came back: the face's normal from landmarks.
 * across = eye corner to eye corner (image left → right), down = forehead →
 * chin. In image space (x right, y down, z away from the camera, x/y/z in
 * roughly width units after correcting y by the aspect ratio) across × down
 * points away from the camera, so forward = -(across × down); flipping y and
 * z then gives camera space for anglesFromForward. Coarser than the matrix,
 * good enough for a ±25° threshold.
 */
export function anglesFromLandmarks(lm: NormalizedLandmark[], aspect = 4 / 3): { yawDeg: number; pitchDeg: number } | null {
  const a = lm?.[EYE_OUTER_IMAGE_LEFT];
  const b = lm?.[EYE_OUTER_IMAGE_RIGHT];
  const top = lm?.[FOREHEAD];
  const bottom = lm?.[CHIN];
  if (!a || !b || !top || !bottom) return null;
  const yScale = 1 / aspect; // normalized y is in height units; convert to width units
  const across = [b.x - a.x, (b.y - a.y) * yScale, (b.z ?? 0) - (a.z ?? 0)];
  const down = [bottom.x - top.x, (bottom.y - top.y) * yScale, (bottom.z ?? 0) - (top.z ?? 0)];
  const n = [
    across[1] * down[2] - across[2] * down[1],
    across[2] * down[0] - across[0] * down[2],
    across[0] * down[1] - across[1] * down[0],
  ];
  // forward (image) = -n; camera space flips y and z: (-n.x, n.y, n.z)
  const [x, y, z] = [-n[0], n[1], n[2]];
  if (Math.hypot(x, y, z) === 0) return null;
  return anglesFromForward(x, y, z);
}

function boxArea(lm: NormalizedLandmark[]): number {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of lm) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return lm.length ? (x1 - x0) * (y1 - y0) : 0;
}

/** One frame's result → numbers only. The main face is the largest one (closest to the camera). */
export function sampleFromResult(result: FaceLandmarkerResult, aspect?: number): GazeSample {
  const faces = result?.faceLandmarks ?? [];
  if (!faces.length) return { faces: 0 };
  let main = 0;
  for (let i = 1; i < faces.length; i++) if (boxArea(faces[i]) > boxArea(faces[main])) main = i;
  const matrix = result.facialTransformationMatrixes?.[main];
  const angles = (matrix && anglesFromMatrix(matrix)) || anglesFromLandmarks(faces[main], aspect);
  return angles ? { faces: faces.length, ...angles } : { faces: faces.length };
}

export function createGazeMonitor({ stream, onSignal, sampleMs = 1000, assetBase = "/mediapipe" }: GazeMonitorOptions): GazeMonitor {
  const state = createGazeState();
  let landmarker: FaceLandmarker | null = null;
  let video: HTMLVideoElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let lastTs = 0;

  function tick() {
    if (stopped || !landmarker || !video) return;
    // Leaving the window is its own signal; don't sample a hidden tab, and don't count the gap.
    if (document.hidden) {
      state.pause();
      return;
    }
    if (video.readyState < 2) return; // no frame yet
    // detectForVideo needs strictly increasing timestamps.
    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;
    let sample: GazeSample;
    try {
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : undefined;
      sample = sampleFromResult(landmarker.detectForVideo(video, ts), aspect);
    } catch {
      return; // a failed frame is skipped, not reported as "no face"
    }
    for (const e of state.update(sample, ts)) {
      const { kind, ...payload } = e;
      onSignal(kind, payload);
    }
  }

  function release() {
    if (timer) clearInterval(timer);
    timer = null;
    try {
      landmarker?.close();
    } catch {
      // already closed
    }
    landmarker = null;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    video = null;
  }

  async function start(): Promise<GazeStartResult> {
    if (typeof document === "undefined" || typeof WebAssembly === "undefined") return "unsupported";
    if (!stream.getVideoTracks().some((t) => t.readyState === "live")) return "unsupported";
    if (timer || landmarker) return "ok";
    try {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(`${assetBase}/wasm`);
      const create = (delegate: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${assetBase}/face_landmarker.task`, delegate },
          runningMode: "VIDEO",
          numFaces: 3,
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: false,
        });
      const lm = await create("GPU").catch(() => create("CPU"));
      if (stopped) {
        lm.close();
        return "failed";
      }
      landmarker = lm;

      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      video = v;
      await v.play();
      if (stopped) return "failed";
      timer = setInterval(tick, sampleMs);
      return "ok";
    } catch {
      release();
      return "failed";
    }
  }

  function stop() {
    stopped = true;
    release();
  }

  return { start, stop };
}
