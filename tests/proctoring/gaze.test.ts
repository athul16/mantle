// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";

const mp = vi.hoisted(() => ({
  detect: vi.fn(),
  close: vi.fn(),
  createFromOptions: vi.fn(),
  forVisionTasks: vi.fn(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mp.forVisionTasks },
  FaceLandmarker: { createFromOptions: mp.createFromOptions },
}));

import {
  anglesFromForward,
  anglesFromLandmarks,
  anglesFromMatrix,
  createGazeMonitor,
  sampleFromResult,
} from "@/lib/proctoring/client/gaze";

const DEG = Math.PI / 180;

/** Rotation: yaw about camera y (positive turns the nose towards image-right), then pitch about x (positive nose up). */
function rotate([x, y, z]: number[], yawRad: number, pitchRad: number): number[] {
  // pitch about x: nose (0,0,1) → (0, sin p, cos p)
  const y1 = y * Math.cos(pitchRad) + z * Math.sin(pitchRad);
  const z1 = -y * Math.sin(pitchRad) + z * Math.cos(pitchRad);
  // yaw about y: nose (0,0,1) → (sin q, 0, cos q)
  return [x * Math.cos(yawRad) + z1 * Math.sin(yawRad), y1, -x * Math.sin(yawRad) + z1 * Math.cos(yawRad)];
}

/** Column-major 4x4 with the given rotation and a translation. */
function matrixFor(yawRad: number, pitchRad: number): Matrix {
  const cols = [rotate([1, 0, 0], yawRad, pitchRad), rotate([0, 1, 0], yawRad, pitchRad), rotate([0, 0, 1], yawRad, pitchRad)];
  return { rows: 4, columns: 4, data: [...cols[0], 0, ...cols[1], 0, ...cols[2], 0, 3, -2, -50, 1] };
}

/** Face mesh landmarks (only the four the fallback uses) for a head rotated in camera space, projected to the image. */
function landmarksFor(yawRad: number, pitchRad: number): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  // Camera space: x right, y up, z towards the camera. Image: x right, y down, z away. Aspect 1 for simplicity.
  const put = (i: number, p: number[]) => {
    const [x, y, z] = rotate(p, yawRad, pitchRad);
    lm[i] = { x: 0.5 + x * 0.1, y: 0.5 - y * 0.1, z: -z * 0.1, visibility: 1 };
  };
  put(33, [-1, 0.3, 0]); // eye corner on image left
  put(263, [1, 0.3, 0]); // eye corner on image right
  put(10, [0, 1.2, 0.1]); // forehead
  put(152, [0, -1.4, 0.1]); // chin
  return lm;
}

describe("angle math", () => {
  it("forward (0,0,1) is straight ahead", () => {
    expect(anglesFromForward(0, 0, 1)).toEqual({ yawDeg: 0, pitchDeg: 0 });
  });

  it("nose to image-right is the candidate's left (negative yaw); nose up is positive pitch", () => {
    expect(anglesFromForward(1, 0, 1).yawDeg).toBeCloseTo(-45);
    expect(anglesFromForward(-1, 0, 1).yawDeg).toBeCloseTo(45);
    expect(anglesFromForward(0, 1, 1).pitchDeg).toBeCloseTo(45);
    expect(anglesFromForward(0, -1, 1).pitchDeg).toBeCloseTo(-45);
  });

  it("reads yaw and pitch from a column-major transformation matrix", () => {
    for (const [yaw, pitch] of [[0, 0], [30, 0], [-30, 0], [0, 25], [0, -25], [20, -15]]) {
      const a = anglesFromMatrix(matrixFor(yaw * DEG, pitch * DEG))!;
      expect(a.yawDeg).toBeCloseTo(-yaw, 5);
      expect(a.pitchDeg).toBeCloseTo(pitch, 5);
    }
  });

  it("rejects malformed matrices", () => {
    expect(anglesFromMatrix({ rows: 3, columns: 3, data: [1, 0, 0, 0, 1, 0, 0, 0, 1] })).toBeNull();
    expect(anglesFromMatrix({ rows: 4, columns: 4, data: Array(16).fill(0) })).toBeNull();
    expect(anglesFromMatrix({ rows: 4, columns: 4, data: Array(16).fill(NaN) })).toBeNull();
  });

  it("the landmark fallback agrees in sign and roughly in size", () => {
    for (const [yaw, pitch] of [[0, 0], [35, 0], [-35, 0], [0, 30], [0, -30]]) {
      const a = anglesFromLandmarks(landmarksFor(yaw * DEG, pitch * DEG), 1)!;
      expect(a.yawDeg).toBeCloseTo(-yaw, 0);
      expect(a.pitchDeg).toBeCloseTo(pitch, 0);
    }
    expect(anglesFromLandmarks([], 1)).toBeNull();
  });
});

describe("sampleFromResult", () => {
  const empty = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };

  it("no faces", () => {
    expect(sampleFromResult(empty)).toEqual({ faces: 0 });
  });

  it("uses the matrix of the largest face", () => {
    const small = landmarksFor(0, 0).map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.3, y: 0.5 + (p.y - 0.5) * 0.3 }));
    const big = landmarksFor(0, 0);
    const s = sampleFromResult({
      ...empty,
      faceLandmarks: [small, big],
      facialTransformationMatrixes: [matrixFor(0, 0), matrixFor(40 * DEG, 0)],
    });
    expect(s.faces).toBe(2);
    expect(s.yawDeg).toBeCloseTo(-40);
  });

  it("falls back to landmarks when the matrix is missing", () => {
    const s = sampleFromResult({ ...empty, faceLandmarks: [landmarksFor(-40 * DEG, 0)] }, 1);
    expect(s.faces).toBe(1);
    expect(s.yawDeg).toBeGreaterThan(30);
  });

  it("keeps the face count when no angle can be found", () => {
    expect(sampleFromResult({ ...empty, faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0, visibility: 1 }]] })).toEqual({ faces: 1 });
  });
});

describe("createGazeMonitor", () => {
  let hidden = false;
  let readyState = 4;
  let now = 0;

  const liveStream = (state: "live" | "ended" = "live") =>
    ({ getVideoTracks: () => [{ readyState: state }] }) as unknown as MediaStream;
  const faceAt = (yaw: number) => ({ faceLandmarks: [landmarksFor(0, 0)], faceBlendshapes: [], facialTransformationMatrixes: [matrixFor(yaw * DEG, 0)] });

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    readyState = 4;
    now = 0;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(() => readyState);
    mp.detect.mockReset().mockReturnValue(faceAt(0));
    mp.close.mockReset();
    mp.forVisionTasks.mockReset().mockResolvedValue({ wasmLoaderPath: "x", wasmBinaryPath: "y" });
    mp.createFromOptions.mockReset().mockResolvedValue({ detectForVideo: mp.detect, close: mp.close });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function tick(ms = 1000) {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("loads self-hosted assets with the GPU delegate, VIDEO mode, 3 faces and matrices", async () => {
    const m = createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() });
    expect(await m.start()).toBe("ok");
    expect(mp.forVisionTasks).toHaveBeenCalledWith("/mediapipe/wasm");
    expect(mp.createFromOptions).toHaveBeenCalledTimes(1);
    expect(mp.createFromOptions.mock.calls[0][1]).toMatchObject({
      baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 3,
      outputFacialTransformationMatrixes: true,
    });
    m.stop();
  });

  it("falls back to the CPU delegate when GPU fails", async () => {
    mp.createFromOptions.mockRejectedValueOnce(new Error("no webgl"));
    const m = createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() });
    expect(await m.start()).toBe("ok");
    expect(mp.createFromOptions.mock.calls[1][1].baseOptions.delegate).toBe("CPU");
    m.stop();
  });

  it("returns failed when the model can't load on either delegate", async () => {
    mp.createFromOptions.mockRejectedValue(new Error("404"));
    expect(await createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() }).start()).toBe("failed");
  });

  it("returns failed when the wasm can't load", async () => {
    mp.forVisionTasks.mockRejectedValue(new Error("network"));
    expect(await createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() }).start()).toBe("failed");
  });

  it("returns unsupported without a live video track or without WebAssembly, and loads nothing", async () => {
    expect(await createGazeMonitor({ stream: liveStream("ended"), onSignal: vi.fn() }).start()).toBe("unsupported");
    vi.stubGlobal("WebAssembly", undefined);
    expect(await createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() }).start()).toBe("unsupported");
    vi.unstubAllGlobals();
    expect(mp.forVisionTasks).not.toHaveBeenCalled();
  });

  it("samples every sampleMs and maps emissions to signals with payloads", async () => {
    const onSignal = vi.fn();
    const m = createGazeMonitor({ stream: liveStream(), onSignal, sampleMs: 1000 });
    await m.start();
    mp.detect.mockReturnValue(faceAt(40)); // nose to image-right: candidate looks to their left
    await tick();
    expect(onSignal).not.toHaveBeenCalled();
    await tick();
    expect(onSignal).toHaveBeenCalledWith("looking_away", { direction: "left" });
    mp.detect.mockReturnValue(faceAt(0));
    await tick();
    await tick();
    expect(onSignal).toHaveBeenLastCalledWith("looking_back", { awayMs: 2000 });
    expect(mp.detect).toHaveBeenCalledTimes(4);
    m.stop();
  });

  it("sends no_face, face_back and multiple_faces with only counts and times", async () => {
    const onSignal = vi.fn();
    const m = createGazeMonitor({ stream: liveStream(), onSignal });
    await m.start();
    mp.detect.mockReturnValue({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] });
    await tick();
    await tick();
    await tick();
    expect(onSignal).toHaveBeenCalledWith("no_face", {});
    const two = { ...faceAt(0), faceLandmarks: [landmarksFor(0, 0), landmarksFor(0, 0)], facialTransformationMatrixes: [matrixFor(0, 0), matrixFor(0, 0)] };
    mp.detect.mockReturnValue(two);
    await tick();
    expect(onSignal).toHaveBeenCalledWith("face_back", { awayMs: 3000 });
    await tick();
    expect(onSignal).toHaveBeenLastCalledWith("multiple_faces", { faces: 2 });
    m.stop();
  });

  it("skips hidden tabs and doesn't count the hidden time", async () => {
    const onSignal = vi.fn();
    const m = createGazeMonitor({ stream: liveStream(), onSignal });
    await m.start();
    mp.detect.mockReturnValue(faceAt(40));
    await tick(); // pending look away
    hidden = true;
    await tick();
    await tick();
    expect(mp.detect).toHaveBeenCalledTimes(1);
    hidden = false;
    await tick(); // new pending run starts here, not a confirmation
    expect(onSignal).not.toHaveBeenCalled();
    await tick();
    expect(onSignal).toHaveBeenCalledWith("looking_away", { direction: "left" });
    m.stop();
  });

  it("skips frames before the video has data and frames where detection throws", async () => {
    const onSignal = vi.fn();
    const m = createGazeMonitor({ stream: liveStream(), onSignal });
    await m.start();
    readyState = 1;
    await tick();
    expect(mp.detect).not.toHaveBeenCalled();
    readyState = 4;
    mp.detect.mockImplementation(() => {
      throw new Error("frame");
    });
    await tick();
    await tick();
    await tick();
    expect(onSignal).not.toHaveBeenCalled(); // a broken frame is not "no face"
    m.stop();
  });

  it("passes strictly increasing timestamps", async () => {
    const m = createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() });
    await m.start();
    await vi.advanceTimersByTimeAsync(1000); // performance.now() didn't move
    await vi.advanceTimersByTimeAsync(1000);
    const [a, b] = mp.detect.mock.calls.map((c) => c[1]);
    expect(b).toBeGreaterThan(a);
    m.stop();
  });

  it("stop() halts sampling, closes the model and is idempotent", async () => {
    const m = createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() });
    await m.start();
    await tick();
    m.stop();
    m.stop();
    expect(mp.close).toHaveBeenCalledTimes(1);
    await tick();
    await tick();
    expect(mp.detect).toHaveBeenCalledTimes(1);
  });

  it("stop() during loading closes the model and start resolves failed", async () => {
    let resolve!: (v: unknown) => void;
    mp.createFromOptions.mockReturnValue(new Promise((r) => (resolve = r)));
    const m = createGazeMonitor({ stream: liveStream(), onSignal: vi.fn() });
    const p = m.start();
    await vi.advanceTimersByTimeAsync(0);
    m.stop();
    resolve({ detectForVideo: mp.detect, close: mp.close });
    expect(await p).toBe("failed");
    expect(mp.close).toHaveBeenCalledTimes(1);
    await tick();
    expect(mp.detect).not.toHaveBeenCalled();
  });
});
