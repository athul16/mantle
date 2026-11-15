import { describe, expect, it } from "vitest";
import { createGazeState, GAZE_TUNING, gazeDirection, type Emission, type GazeSample } from "@/lib/proctoring/client/gaze-logic";

/** Feeds samples one second apart (t = 0, 1000, ...) and collects every emission with its time. */
function run(samples: GazeSample[], opts?: Parameters<typeof createGazeState>[0], stepMs = 1000) {
  const state = createGazeState(opts);
  const out: Array<{ at: number } & Emission> = [];
  samples.forEach((s, i) => {
    for (const e of state.update(s, i * stepMs)) out.push({ at: i * stepMs, ...e });
  });
  return out;
}

const ok: GazeSample = { faces: 1, yawDeg: 0, pitchDeg: 0 };
const left: GazeSample = { faces: 1, yawDeg: -40, pitchDeg: 0 };
const right: GazeSample = { faces: 1, yawDeg: 40, pitchDeg: 0 };
const none: GazeSample = { faces: 0 };
const two: GazeSample = { faces: 2, yawDeg: 0, pitchDeg: 0 };

describe("tuning", () => {
  it("exports the documented defaults", () => {
    expect(GAZE_TUNING).toEqual({
      yawLimitDeg: 25,
      pitchLimitDeg: 20,
      awayAfterMs: 1000,
      backAfterMs: 500,
      noFaceAfterMs: 2000,
      multipleFacesSamples: 2,
      singleFaceSamples: 2,
    });
  });
});

describe("gazeDirection", () => {
  it("is null within limits, including exactly on them", () => {
    expect(gazeDirection(0, 0)).toBeNull();
    expect(gazeDirection(25, -20)).toBeNull();
    expect(gazeDirection(-25, 20)).toBeNull();
  });
  it("maps yaw sign to right/left and pitch sign to up/down", () => {
    expect(gazeDirection(30, 0)).toBe("right");
    expect(gazeDirection(-30, 0)).toBe("left");
    expect(gazeDirection(0, 25)).toBe("up");
    expect(gazeDirection(0, -25)).toBe("down");
  });
  it("picks the larger excess when both are out of limits", () => {
    expect(gazeDirection(30, 30)).toBe("up"); // yaw +5 over, pitch +10 over
    expect(gazeDirection(-45, -25)).toBe("left"); // yaw 20 over, pitch 5 over
  });
  it("treats a missing angle as within limits", () => {
    expect(gazeDirection(undefined, -30)).toBe("down");
    expect(gazeDirection(40, undefined)).toBe("right");
    expect(gazeDirection(undefined, undefined)).toBeNull();
  });
  it("respects custom limits", () => {
    expect(gazeDirection(15, 0, { yawLimitDeg: 10, pitchLimitDeg: 10 })).toBe("right");
  });
});

describe("looking away", () => {
  it("never emits while the candidate faces the screen", () => {
    expect(run([ok, ok, ok, ok, ok])).toEqual([]);
  });

  it("needs at least 1 s out of limits", () => {
    expect(run([ok, left])).toEqual([]);
    expect(run([ok, left, left])).toEqual([{ at: 2000, kind: "looking_away", direction: "left" }]);
  });

  it("a single glance between in-limit samples does not count", () => {
    expect(run([left, ok, right, ok, left, ok])).toEqual([]);
  });

  it("emits the direction from the first out-of-limits sample and no duplicates while away", () => {
    const out = run([right, right, right, left, right, right]);
    expect(out).toEqual([{ at: 1000, kind: "looking_away", direction: "right" }]);
  });

  it("emits up and down from pitch", () => {
    expect(run([{ faces: 1, yawDeg: 0, pitchDeg: 30 }, { faces: 1, yawDeg: 0, pitchDeg: 30 }])[0]).toMatchObject({ direction: "up" });
    expect(run([{ faces: 1, yawDeg: 0, pitchDeg: -30 }, { faces: 1, yawDeg: 0, pitchDeg: -30 }])[0]).toMatchObject({ direction: "down" });
  });

  it("comes back after 0.5 s within limits, with awayMs from the first away sample to the first back sample", () => {
    const out = run([ok, left, left, left, ok, ok, ok]);
    expect(out).toEqual([
      { at: 2000, kind: "looking_away", direction: "left" },
      { at: 5000, kind: "looking_back", awayMs: 3000 },
    ]);
  });

  it("a single in-limit sample shorter than 0.5 s does not end the look away", () => {
    // Samples 400 ms apart: away 0..1200 (confirmed at 1200), back for one sample at 1600, away again 2000..2400.
    const s = [left, left, left, left, ok, left, left, ok, ok];
    expect(run(s, undefined, 400)).toEqual([{ at: 1200, kind: "looking_away", direction: "left" }]);
    // Back from 2800; 3600 is the first sample at least 500 ms later.
    expect(run([...s, ok], undefined, 400)).toEqual([
      { at: 1200, kind: "looking_away", direction: "left" },
      { at: 3600, kind: "looking_back", awayMs: 2800 },
    ]);
  });

  it("can look away again after coming back", () => {
    const out = run([left, left, ok, ok, right, right, ok, ok]);
    expect(out.map((e) => e.kind)).toEqual(["looking_away", "looking_back", "looking_away", "looking_back"]);
    expect(out[2]).toMatchObject({ direction: "right" });
  });

  it("ignores samples with a face but no angles (unknown pose)", () => {
    expect(run([left, { faces: 1 }, left])).toEqual([{ at: 2000, kind: "looking_away", direction: "left" }]);
    const out = run([left, left, ok, { faces: 1 }, ok]);
    expect(out.at(-1)).toEqual({ at: 4000, kind: "looking_back", awayMs: 2000 });
  });

  it("uses the custom tunables", () => {
    expect(run([left, left], { awayAfterMs: 3000 })).toEqual([]);
    expect(run([{ faces: 1, yawDeg: 15 }, { faces: 1, yawDeg: 15 }], { yawLimitDeg: 10 })).toHaveLength(1);
  });
});

describe("no face", () => {
  it("needs at least 2 s without a face", () => {
    expect(run([ok, none, none])).toEqual([]);
    expect(run([ok, none, none, none])).toEqual([{ at: 3000, kind: "no_face" }]);
  });

  it("comes back on the first sample with a face, with awayMs since the first empty sample", () => {
    const out = run([none, none, none, none, ok, ok]);
    expect(out).toEqual([
      { at: 2000, kind: "no_face" },
      { at: 4000, kind: "face_back", awayMs: 4000 },
    ]);
  });

  it("emits no_face once however long it lasts", () => {
    expect(run(Array(20).fill(none)).filter((e) => e.kind === "no_face")).toHaveLength(1);
  });

  it("a short gap does not count and resets", () => {
    expect(run([none, ok, none, ok, none, ok])).toEqual([]);
  });

  it("a face with unknown angles still counts as a face", () => {
    expect(run([none, none, none, { faces: 1 }]).at(-1)).toEqual({ at: 3000, kind: "face_back", awayMs: 3000 });
  });

  it("does not touch the gaze state: an open look away stays open through a missing face", () => {
    const out = run([left, left, none, none, none, left, ok, ok]);
    expect(out).toEqual([
      { at: 1000, kind: "looking_away", direction: "left" },
      { at: 4000, kind: "no_face" },
      { at: 5000, kind: "face_back", awayMs: 3000 },
      { at: 7000, kind: "looking_back", awayMs: 6000 },
    ]);
  });

  it("a missing face resets a pending look away", () => {
    expect(run([left, none, left])).toEqual([]);
  });
});

describe("multiple faces", () => {
  it("needs 2 consecutive samples with 2 or more faces", () => {
    expect(run([two, ok, two, ok])).toEqual([]);
    expect(run([ok, two, two])).toEqual([{ at: 2000, kind: "multiple_faces", faces: 2 }]);
  });

  it("reports the face count of the confirming sample", () => {
    expect(run([two, { faces: 3, yawDeg: 0, pitchDeg: 0 }])).toEqual([{ at: 1000, kind: "multiple_faces", faces: 3 }]);
  });

  it("emits once while it lasts, even if the count changes", () => {
    const out = run([two, two, { faces: 3 }, two, { faces: 3 }]);
    expect(out).toEqual([{ at: 1000, kind: "multiple_faces", faces: 2 }]);
  });

  it("single_face after 2 consecutive samples with at most one face", () => {
    const out = run([two, two, ok, two, ok, ok, ok]);
    expect(out).toEqual([
      { at: 1000, kind: "multiple_faces", faces: 2 },
      { at: 5000, kind: "single_face" },
    ]);
  });

  it("zero faces counts toward single_face", () => {
    const out = run([two, two, none, none]);
    expect(out).toEqual([
      { at: 1000, kind: "multiple_faces", faces: 2 },
      { at: 3000, kind: "single_face" },
    ]);
  });

  it("never emits single_face without a multiple_faces first", () => {
    expect(run([ok, ok, ok, none, ok])).toEqual([]);
  });

  it("gaze still works with several faces in view", () => {
    const l2: GazeSample = { faces: 2, yawDeg: -40, pitchDeg: 0 };
    const out = run([l2, l2]);
    expect(out).toEqual([
      { at: 1000, kind: "looking_away", direction: "left" },
      { at: 1000, kind: "multiple_faces", faces: 2 },
    ]);
  });
});

describe("pause", () => {
  it("clears pending timers so a hidden stretch does not count", () => {
    const state = createGazeState();
    expect(state.update(left, 0)).toEqual([]);
    state.pause();
    // 30 s later one away sample alone must not confirm a look away.
    expect(state.update(left, 30_000)).toEqual([]);
    expect(state.update(left, 31_000)).toEqual([{ kind: "looking_away", direction: "left" }]);
  });

  it("clears a pending no-face and multiple-face run", () => {
    const state = createGazeState();
    state.update(none, 0);
    state.update(two, 500);
    state.pause();
    expect(state.update(none, 10_000)).toEqual([]);
    const s2 = createGazeState();
    s2.update(two, 0);
    s2.pause();
    expect(s2.update(two, 1000)).toEqual([]);
  });

  it("keeps confirmed states, so there are no duplicates after a pause", () => {
    const state = createGazeState();
    state.update(left, 0);
    state.update(left, 1000);
    state.pause();
    expect(state.update(left, 5000)).toEqual([]);
    expect(state.update(ok, 6000)).toEqual([]);
    expect(state.update(ok, 7000)).toEqual([{ kind: "looking_back", awayMs: 6000 }]);
  });
});

describe("no duplicates (fuzz)", () => {
  it("alternates start and end kinds strictly over a random run", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const samples: GazeSample[] = Array.from({ length: 2000 }, () => {
      const faces = rnd() < 0.25 ? 0 : rnd() < 0.15 ? 2 : 1;
      return faces === 0 ? { faces } : { faces, yawDeg: (rnd() - 0.5) * 100, pitchDeg: (rnd() - 0.5) * 70 };
    });
    const out = run(samples);
    const pairs: Array<[Emission["kind"], Emission["kind"]]> = [
      ["looking_away", "looking_back"],
      ["no_face", "face_back"],
      ["multiple_faces", "single_face"],
    ];
    for (const [start, end] of pairs) {
      const seq = out.filter((e) => e.kind === start || e.kind === end).map((e) => e.kind);
      expect(seq.length).toBeGreaterThan(0);
      seq.forEach((k, i) => expect(k).toBe(i % 2 === 0 ? start : end));
    }
    for (const e of out) if ("awayMs" in e) expect(e.awayMs).toBeGreaterThan(0);
  });
});
