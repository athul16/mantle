import { describe, expect, it } from "vitest";
import {
  AUDIO_CLIP_MAX_MS,
  AUDIO_MIME_TYPES,
  AWAY_CAPTURE_DELAYS_MS,
  AWAY_CAPTURE_INTERVAL_MS,
  CAPTURE_REASONS,
  CLIENT_SIGNAL_KINDS,
  MAX_MEDIA_PER_ATTEMPT,
  MAX_SNAPSHOTS_PER_ATTEMPT,
  MONITORING_CONSENT_VERSION,
  isMonitored,
  monitoringNotice,
  readProctoring,
  type Proctoring,
} from "@/lib/proctoring/config";

const OFF: Proctoring = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false };

describe("readProctoring", () => {
  it("reads every setting as strictly true, default false", () => {
    expect(readProctoring(null)).toEqual(OFF);
    expect(readProctoring({ camera: "yes", screen: 1 })).toEqual(OFF);
    expect(readProctoring({ camera: true, screen: true, fullscreen: true, microphone: true, gaze: true })).toEqual({
      camera: true,
      screen: true,
      fullscreen: true,
      microphone: true,
      gaze: true,
    });
  });

  it("still parses old rows with only camera and screen", () => {
    expect(readProctoring({ camera: true, screen: false })).toEqual({ ...OFF, camera: true });
  });

  it("turns gaze off without the camera", () => {
    expect(readProctoring({ gaze: true, screen: true })).toEqual({ ...OFF, screen: true });
    expect(readProctoring({ gaze: true, camera: true })).toEqual({ ...OFF, camera: true, gaze: true });
  });
});

describe("isMonitored", () => {
  it("counts camera, screen or microphone, not full screen or gaze alone", () => {
    expect(isMonitored(OFF)).toBe(false);
    expect(isMonitored({ ...OFF, fullscreen: true })).toBe(false);
    expect(isMonitored({ ...OFF, gaze: true })).toBe(false);
    expect(isMonitored({ ...OFF, camera: true })).toBe(true);
    expect(isMonitored({ ...OFF, screen: true })).toBe(true);
    expect(isMonitored({ ...OFF, microphone: true })).toBe(true);
  });
});

describe("signal kinds and capture constants", () => {
  it("keeps the old kinds in order and appends the new ones", () => {
    expect(CLIENT_SIGNAL_KINDS.slice(0, 13)).toEqual([
      "left_window",
      "returned_to_window",
      "fullscreen_exited",
      "copied",
      "pasted",
      "camera_started",
      "camera_stopped",
      "camera_refused",
      "screen_share_started",
      "screen_share_stopped",
      "screen_share_refused",
      "screen_share_wrong_surface",
      "multiple_displays",
    ]);
    expect(CLIENT_SIGNAL_KINDS.slice(13)).toEqual([
      "cut",
      "fullscreen_entered",
      "looking_away",
      "looking_back",
      "no_face",
      "face_back",
      "multiple_faces",
      "single_face",
      "speech_started",
      "speech_stopped",
      "microphone_started",
      "microphone_stopped",
      "microphone_refused",
    ]);
  });

  it("has the capture reasons and limits", () => {
    expect(CAPTURE_REASONS).toEqual(["interval", "left_window", "away", "returned", "speech", "start"]);
    expect(AWAY_CAPTURE_DELAYS_MS).toEqual([2_000, 6_000]);
    expect(AWAY_CAPTURE_INTERVAL_MS).toBe(10_000);
    expect(AUDIO_CLIP_MAX_MS).toBe(15_000);
    expect(AUDIO_MIME_TYPES).toEqual(["audio/webm", "audio/ogg", "audio/mp4"]);
    expect(MAX_MEDIA_PER_ATTEMPT).toBe(2400);
    expect(MAX_SNAPSHOTS_PER_ATTEMPT).toBe(MAX_MEDIA_PER_ATTEMPT);
  });
});

describe("monitoring notice", () => {
  it("has a new consent version for the v2 wording", () => {
    expect(MONITORING_CONSENT_VERSION).toBe("2026-11-15.proctoring-v2");
  });

  it("describes full screen, microphone and gaze only when they are on", () => {
    const off = monitoringNotice({ ...OFF, camera: true }, "Acme").join("\n");
    expect(off).not.toMatch(/full screen is required/i);
    expect(off).not.toMatch(/audio/);
    expect(off).not.toMatch(/facing the screen/);
    expect(off).toContain("We don't use the photos to identify you.");

    const on = monitoringNotice({ camera: true, screen: true, fullscreen: true, microphone: true, gaze: true }, "Acme").join("\n");
    expect(on).toMatch(/full screen is required/i);
    expect(on).toContain("short audio clips when we hear speech, plus when speech starts and stops");
    expect(on).toContain(
      "your device checks whether you are facing the screen and how many faces it sees; only the result is sent, never the image or a face template",
    );
    expect(on).toContain("We don't use the photos to identify you.");
  });
});
