/**
 * Pure debounce logic for the on-device gaze and face-count check. It takes
 * one sample per tick (how many faces, and the head angles of the main face)
 * and returns the signals to send. No image, landmark or face template ever
 * reaches this module; it only sees numbers, and it never identifies anyone.
 *
 * Angle convention (from the candidate's point of view, see gaze.ts):
 * yaw > 0 is the head turned to the candidate's right, pitch > 0 is the head
 * tilted up.
 */

export type GazeDirection = "left" | "right" | "up" | "down";

export interface GazeSample {
  /** Faces seen in this frame (0 when none). */
  faces: number;
  /** Head yaw of the main face, degrees; absent when unknown. */
  yawDeg?: number;
  /** Head pitch of the main face, degrees; absent when unknown. */
  pitchDeg?: number;
}

export type Emission =
  | { kind: "looking_away"; direction: GazeDirection }
  | { kind: "looking_back"; awayMs: number }
  | { kind: "no_face" }
  | { kind: "face_back"; awayMs: number }
  | { kind: "multiple_faces"; faces: number }
  | { kind: "single_face" };

/** Tunables. Server-side flag thresholds (how much counts) live in rules.ts THRESHOLDS. */
export const GAZE_TUNING = {
  /** Head turned further than this left or right counts as looking away (a laptop screen spans roughly ±20°). */
  yawLimitDeg: 25,
  /** Head tilted further than this up or down counts as looking away (typing glances at the keyboard stay inside). */
  pitchLimitDeg: 20,
  /** Out of limits this long before looking_away is sent, so quick glances are ignored. */
  awayAfterMs: 1000,
  /** Back within limits this long before looking_back is sent, so a passing glance back doesn't split a look away. */
  backAfterMs: 500,
  /** No face this long before no_face is sent (one missed detection is common). face_back needs one sample with a face. */
  noFaceAfterMs: 2000,
  /** Consecutive samples with 2+ faces before multiple_faces is sent. */
  multipleFacesSamples: 2,
  /** Consecutive samples with at most one face before single_face is sent. */
  singleFaceSamples: 2,
};
export type GazeTuning = typeof GAZE_TUNING;

/** Which way the head points, or null within limits. A missing angle counts as within limits; the larger excess wins. */
export function gazeDirection(
  yawDeg: number | undefined,
  pitchDeg: number | undefined,
  limits: Pick<GazeTuning, "yawLimitDeg" | "pitchLimitDeg"> = GAZE_TUNING,
): GazeDirection | null {
  const yawOver = yawDeg === undefined ? 0 : Math.abs(yawDeg) - limits.yawLimitDeg;
  const pitchOver = pitchDeg === undefined ? 0 : Math.abs(pitchDeg) - limits.pitchLimitDeg;
  if (yawOver <= 0 && pitchOver <= 0) return null;
  if (yawOver >= pitchOver) return yawDeg! > 0 ? "right" : "left";
  return pitchDeg! > 0 ? "up" : "down";
}

export interface GazeState {
  /** Feeds one sample taken at nowMs (monotonic) and returns what to send, in order: face presence, gaze, face count. */
  update(sample: GazeSample, nowMs: number): Emission[];
  /**
   * Forgets pending (unconfirmed) runs, e.g. while the tab is hidden, so time
   * not sampled is never counted. Confirmed states stay, so nothing repeats.
   */
  pause(): void;
}

/**
 * Rules:
 * - looking_away when out of limits for >= awayAfterMs (direction from the
 *   first out-of-limits sample); looking_back after >= backAfterMs within
 *   limits, awayMs from the first away sample to the first back sample.
 * - no_face after >= noFaceAfterMs with no face; face_back on the first
 *   sample with a face, awayMs since the first empty sample.
 * - multiple_faces after N consecutive samples with 2+ faces; single_face
 *   after M consecutive samples with at most one.
 * - Samples with no face, or a face with unknown angles, leave the gaze state
 *   alone (a look away stays open while the face is gone) but a missing face
 *   resets pending gaze runs.
 */
export function createGazeState(opts: Partial<GazeTuning> = {}): GazeState {
  const t: GazeTuning = { ...GAZE_TUNING, ...opts };

  // Gaze
  let away = false;
  let awayStart: number | null = null; // first out-of-limits sample of the current (pending or confirmed) look away
  let awayDirection: GazeDirection | null = null;
  let backSince: number | null = null;
  // Face presence
  let noFace = false;
  let noFaceSince: number | null = null;
  // Face count
  let multiple = false;
  let manyRun = 0;
  let fewRun = 0;

  function pause() {
    if (!away) {
      awayStart = null;
      awayDirection = null;
    }
    backSince = null;
    if (!noFace) noFaceSince = null;
    manyRun = 0;
    fewRun = 0;
  }

  function update(sample: GazeSample, nowMs: number): Emission[] {
    const out: Emission[] = [];
    const faces = Math.max(0, Math.floor(sample.faces || 0));

    // Face presence
    if (faces === 0) {
      noFaceSince ??= nowMs;
      if (!noFace && nowMs - noFaceSince >= t.noFaceAfterMs) {
        noFace = true;
        out.push({ kind: "no_face" });
      }
    } else {
      if (noFace) out.push({ kind: "face_back", awayMs: Math.max(0, nowMs - noFaceSince!) });
      noFace = false;
      noFaceSince = null;
    }

    // Gaze
    if (faces === 0) {
      if (!away) {
        awayStart = null;
        awayDirection = null;
      }
      backSince = null;
    } else if (sample.yawDeg !== undefined || sample.pitchDeg !== undefined) {
      const dir = gazeDirection(sample.yawDeg, sample.pitchDeg, t);
      if (dir) {
        backSince = null;
        if (awayStart === null) {
          awayStart = nowMs;
          awayDirection = dir;
        }
        if (!away && nowMs - awayStart >= t.awayAfterMs) {
          away = true;
          out.push({ kind: "looking_away", direction: awayDirection! });
        }
      } else if (away) {
        backSince ??= nowMs;
        if (nowMs - backSince >= t.backAfterMs) {
          out.push({ kind: "looking_back", awayMs: Math.max(0, backSince - awayStart!) });
          away = false;
          awayStart = null;
          awayDirection = null;
          backSince = null;
        }
      } else {
        awayStart = null;
        awayDirection = null;
      }
    }

    // Face count
    if (faces >= 2) {
      manyRun += 1;
      fewRun = 0;
      if (!multiple && manyRun >= t.multipleFacesSamples) {
        multiple = true;
        out.push({ kind: "multiple_faces", faces });
      }
    } else {
      fewRun += 1;
      manyRun = 0;
      if (multiple && fewRun >= t.singleFaceSamples) {
        multiple = false;
        out.push({ kind: "single_face" });
      }
    }

    return out;
  }

  return { update, pause };
}
