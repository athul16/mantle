/**
 * Proctoring rules v2: copy, away filmstrips, required full screen, gaze, face
 * count, speech and the severity-based label. Pure functions, no database.
 * Flags are labels with evidence for a person; nothing here rejects anyone.
 */
import { describe, expect, it } from "vitest";
import type { Proctoring } from "@/lib/proctoring/config";
import {
  RULE_SEVERITY,
  THRESHOLDS,
  downPeriods,
  evaluateRules,
  integrityLabel,
  labelReasons,
  parseSignalBatch,
  type FlagDraft,
  type MediaRef,
  type RuleId,
  type SignalEvent,
} from "@/lib/proctoring/rules";

const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

let nextId = 1;
function ev(kind: SignalEvent["kind"], seconds: number, payload: SignalEvent["payload"] = {}): SignalEvent {
  return { id: nextId++, at: at(seconds), kind, payload };
}
const media = (id: number, source: MediaRef["source"], seconds: number, reason: MediaRef["reason"] = null): MediaRef => ({
  id,
  source,
  at: at(seconds),
  reason,
});

const off: Proctoring = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false };
const both: Proctoring = { ...off, camera: true, screen: true };
const all: Proctoring = { camera: true, screen: true, fullscreen: true, microphone: true, gaze: true };
const rules = (flags: FlagDraft[]) => flags.map((f) => f.rule).sort();
const find = (flags: FlagDraft[], rule: RuleId) => flags.find((f) => f.rule === rule);

describe("parseSignalBatch (v2 payloads)", () => {
  const now = new Date(T0 + 600_000);
  const parse = (signal: Record<string, unknown>) => parseSignalBatch({ signals: [{ at: at(500), ...signal }] }, now)[0];

  it("keeps the length of copied, cut and pasted text, never the text", () => {
    expect(parse({ kind: "copied", chars: 12, text: "x" }).payload).toEqual({ chars: 12 });
    expect(parse({ kind: "cut", chars: 7 }).payload).toEqual({ chars: 7 });
    expect(parse({ kind: "pasted", chars: 3 }).payload).toEqual({ chars: 3 });
  });

  it("keeps how long the candidate was away, looking away or out of view", () => {
    expect(parse({ kind: "returned_to_window", awayMs: 2000 }).payload).toEqual({ awayMs: 2000 });
    expect(parse({ kind: "looking_back", awayMs: 4000 }).payload).toEqual({ awayMs: 4000 });
    expect(parse({ kind: "face_back", awayMs: 9000 }).payload).toEqual({ awayMs: 9000 });
    expect(parse({ kind: "looking_away", awayMs: 9000 }).payload).toEqual({});
  });

  it("keeps a known gaze direction and drops anything else", () => {
    expect(parse({ kind: "looking_away", direction: "left" }).payload).toEqual({ direction: "left" });
    expect(parse({ kind: "looking_away", direction: "behind" }).payload).toEqual({});
    expect(parse({ kind: "looking_back", direction: "left" }).payload).toEqual({});
  });

  it("bounds the face count to 2..10 whole faces", () => {
    expect(parse({ kind: "multiple_faces", faces: 3 }).payload).toEqual({ faces: 3 });
    expect(parse({ kind: "multiple_faces", faces: 2.6 }).payload).toEqual({ faces: 3 });
    expect(parse({ kind: "multiple_faces", faces: 500 }).payload).toEqual({ faces: 10 });
    expect(parse({ kind: "multiple_faces", faces: 1 }).payload).toEqual({ faces: 2 });
    expect(parse({ kind: "multiple_faces", faces: "many" }).payload).toEqual({});
    expect(parse({ kind: "single_face", faces: 4 }).payload).toEqual({});
  });

  it("keeps the speech length on speech_stopped only", () => {
    expect(parse({ kind: "speech_stopped", speechMs: 4200 }).payload).toEqual({ speechMs: 4200 });
    expect(parse({ kind: "speech_started", speechMs: 4200 }).payload).toEqual({});
    expect(parse({ kind: "speech_stopped", speechMs: -1 }).payload).toEqual({});
  });

  it("drops extra fields on the other new kinds", () => {
    expect(parse({ kind: "fullscreen_entered", chars: 5 }).payload).toEqual({});
    expect(parse({ kind: "microphone_started", surface: "monitor" }).payload).toEqual({});
  });
});

describe("copy", () => {
  it(`flags ${THRESHOLDS.copyCount} copies or cuts, with the count and characters in the reason`, () => {
    const two = [ev("copied", 10, { chars: 5 }), ev("cut", 20, { chars: 5 })];
    expect(find(evaluateRules(two, [], both), "copy")).toBeUndefined();
    const flags = evaluateRules([...two, ev("copied", 30, { chars: 2 }), ev("copied", 40, { chars: 500 })], [], both);
    expect(find(flags, "copy")?.reason).toBe("Copied text 4 times (512 characters)");
    expect(find(flags, "copy")?.evidence.events.map((e) => e.kind)).toEqual(["copied", "cut", "copied", "copied"]);
  });

  it(`flags ${THRESHOLDS.copyChars} copied characters in one go`, () => {
    const flags = evaluateRules([ev("copied", 10, { chars: THRESHOLDS.copyChars })], [], both);
    expect(find(flags, "copy")?.reason).toBe(`Copied text 1 time (${THRESHOLDS.copyChars} characters)`);
  });
});

describe("copy_then_leave", () => {
  it(`flags a copy followed by leaving the window within ${THRESHOLDS.copyThenLeaveSeconds} s`, () => {
    const events = [
      ev("copied", 100, { chars: 40 }),
      ev("left_window", 105),
      ev("returned_to_window", 108, { awayMs: 3000 }),
      ev("cut", 200, { chars: 10 }),
      ev("left_window", 200 + THRESHOLDS.copyThenLeaveSeconds),
      ev("returned_to_window", 215, { awayMs: 5000 }),
      ev("copied", 300, { chars: 10 }),
      ev("left_window", 330), // too late
    ];
    const flag = find(evaluateRules(events, [], both), "copy_then_leave");
    expect(flag?.reason).toBe("Copied text, then left the test window within 10 s (2 times)");
    expect(flag?.evidence.total).toBe(2);
    expect(flag?.evidence.events.map((e) => [e.kind, e.at])).toEqual([
      ["copied", at(100)],
      ["left_window", at(105)],
      ["cut", at(200)],
      ["left_window", at(210)],
    ]);
  });

  it("does not flag leaving before copying, or a copy without leaving", () => {
    const events = [ev("left_window", 100), ev("returned_to_window", 102, { awayMs: 2000 }), ev("copied", 103, { chars: 3 })];
    expect(find(evaluateRules(events, [], both), "copy_then_leave")).toBeUndefined();
  });

  it("pairs one departure with one copy even after several copies", () => {
    const events = [ev("copied", 100, { chars: 1 }), ev("copied", 102, { chars: 1 }), ev("left_window", 104)];
    const flag = find(evaluateRules(events, [], both), "copy_then_leave");
    expect(flag?.reason).toBe("Copied text, then left the test window within 10 s (1 time)");
    expect(flag?.evidence.events.map((e) => e.at)).toEqual([at(102), at(104)]);
  });
});

describe("away filmstrip", () => {
  const away = (fromS: number, toS: number) => [ev("left_window", fromS), ev("returned_to_window", toS, { awayMs: (toS - fromS) * 1000 })];

  it("attaches every screen and camera capture taken while away to the departure", () => {
    const events = [...away(100, 140), ...away(200, 205), ...away(300, 340)];
    const snaps = [
      media(1, "screen", 90, "interval"), // before leaving
      media(2, "screen", 102, "away"),
      media(3, "camera", 102, "away"),
      media(4, "screen", 120, "away"),
      media(5, "audio", 125, "speech"), // audio is not a filmstrip frame
      media(6, "screen", 141, "returned"), // uploaded just after coming back
      media(7, "screen", 160, "interval"), // back at work
      media(8, "screen", 302, "away"),
    ];
    const flag = find(evaluateRules(events, snaps, both), "left_window")!;
    const [first, second, third] = flag.evidence.events;
    expect(first.mediaIds).toEqual([2, 3, 4, 6]);
    expect(second.mediaIds).toBeUndefined();
    expect(third.mediaIds).toEqual([8]);
    // The flag's own snapshots still include the first away screenshot of each departure.
    expect(flag.evidence.mediaIds).toEqual(expect.arrayContaining([2, 8]));
  });

  it(`keeps at most ${THRESHOLDS.awayMediaPerDeparture} frames per departure, preferring away captures`, () => {
    const events = away(0, 600);
    const snaps = [
      ...Array.from({ length: 10 }, (_, n) => media(100 + n, "screen", 5 + n * 10, "interval")),
      ...Array.from({ length: 6 }, (_, n) => media(200 + n, "screen", 7 + n * 50, "away")),
    ];
    const ids = find(evaluateRules(events, snaps, both), "left_window")!.evidence.events[0].mediaIds!;
    expect(ids).toHaveLength(THRESHOLDS.awayMediaPerDeparture);
    expect(ids.filter((id) => id >= 200)).toHaveLength(6);
    // In time order.
    const t = (id: number) => snaps.find((m) => m.id === id)!.at;
    expect([...ids].sort((a, b) => t(a).localeCompare(t(b)))).toEqual(ids);
  });

  it("uses the next 10 minutes (or the next departure) when the candidate never came back", () => {
    const events = [ev("left_window", 0)];
    const snaps = [media(1, "screen", 30, "away"), media(2, "screen", 590, "away"), media(3, "screen", 700, "away")];
    const flag = find(evaluateRules(events, snaps, { ...both }), "left_window");
    // One departure without a return does not raise left_window on its own; check via three.
    expect(flag).toBeUndefined();
    const three = [ev("left_window", 0), ev("left_window", 1000), ev("left_window", 1010)];
    const f = find(evaluateRules(three, snaps, both), "left_window")!;
    expect(f.evidence.events[0].mediaIds).toEqual([1, 2]);
  });
});

describe("full screen required", () => {
  const required: Proctoring = { ...both, fullscreen: true };

  it("treats leaving full screen until re-entering as a down period", () => {
    const events = [ev("fullscreen_entered", 0), ev("fullscreen_exited", 100), ev("fullscreen_entered", 140)];
    expect(downPeriods(events)).toEqual([
      { source: "fullscreen", stopEventId: events[1].id, from: at(100), to: at(140), downMs: 40_000, closedBy: "reconnected" },
    ]);
    expect(downPeriods([ev("fullscreen_exited", 10)], { at: at(70), closedBy: "submitted" })).toMatchObject([
      { source: "fullscreen", downMs: 60_000, closedBy: "submitted" },
    ]);
  });

  function down(source: "camera" | "screen" | "fullscreen", fromS: number, toS: number): SignalEvent {
    return ev("monitoring_down", fromS, { source, from: at(fromS), to: at(toS), downMs: (toS - fromS) * 1000, closedBy: "reconnected", stopEventId: nextId + 5000 });
  }

  it("raises downtime for a long full screen exit when full screen is required, not the exit count", () => {
    const events = [ev("fullscreen_exited", 100), ev("fullscreen_exited", 200), down("fullscreen", 100, 140)];
    const flags = evaluateRules(events, [], required);
    expect(rules(flags)).toEqual(["downtime"]);
    expect(find(flags, "downtime")?.reason).toBe("Left full screen 1 time: the task was covered for 40 s in total while the timer kept running");
    expect(find(flags, "downtime")?.evidence.events[0]).toMatchObject({ source: "fullscreen", downMs: 40_000 });
  });

  it("names all sources when full screen and camera gaps both count", () => {
    const flag = find(evaluateRules([down("fullscreen", 0, 20), down("camera", 100, 140)], [], required), "downtime");
    expect(flag?.reason).toBe("Camera, screen share or full screen was down 2 times: the task was covered for 1 min in total while the timer kept running");
  });

  it("ignores full screen gaps when full screen is not required and keeps the exit count rule", () => {
    const events = [ev("fullscreen_exited", 100), ev("fullscreen_exited", 200), down("fullscreen", 100, 190)];
    expect(rules(evaluateRules(events, [], both))).toEqual(["fullscreen"]);
  });
});

describe("gaze, faces and speech", () => {
  const look = (fromS: number, seconds: number, direction = "left") => [
    ev("looking_away", fromS, { direction }),
    ev("looking_back", fromS + seconds, { awayMs: seconds * 1000 }),
  ];

  it("ignores gaze, face and speech signals when the assessment does not use them", () => {
    const events = [...look(0, 20), ev("no_face", 50), ev("face_back", 80, { awayMs: 30_000 }), ev("multiple_faces", 90, { faces: 2 }), ev("speech_started", 100), ev("speech_stopped", 140, { speechMs: 40_000 })];
    expect(evaluateRules(events, [], both)).toEqual([]);
  });

  it(`flags ${THRESHOLDS.gazeAwayCount} looks away of ${THRESHOLDS.gazeAwaySeconds} s or more`, () => {
    const four = [0, 30, 60, 90].flatMap((s) => look(s, 3));
    expect(find(evaluateRules([...four, ...look(120, 2)], [], all), "gaze")).toBeUndefined();
    const flag = find(evaluateRules([...four, ...look(120, 4, "down")], [], all), "gaze");
    expect(flag?.reason).toBe("Looked away from the screen 5 times (16 s in total, longest 4 s)");
    expect(flag?.evidence.events.at(-1)).toMatchObject({ kind: "looking_away", direction: "down", awayMs: 4000, endAt: at(124) });
  });

  it(`flags one look away of ${THRESHOLDS.gazeLongSeconds} s or ${THRESHOLDS.gazeTotalSeconds} s in total`, () => {
    expect(find(evaluateRules(look(0, 10), [], all), "gaze")?.reason).toBe("Looked away from the screen 1 time (10 s in total, longest 10 s)");
    const short = Array.from({ length: 23 }, (_, n) => look(n * 20, 2)).flat();
    expect(find(evaluateRules(short, [], all), "gaze")).toBeDefined();
    expect(find(evaluateRules(short.slice(0, 44), [], all), "gaze")).toBeUndefined();
  });

  it("measures a look by its timestamps when the browser sent no length", () => {
    const flag = find(evaluateRules([ev("looking_away", 0), ev("looking_back", 12)], [], all), "gaze");
    expect(flag?.evidence.events[0]).toMatchObject({ awayMs: 12_000 });
  });

  it(`flags no face in view for ${THRESHOLDS.noFaceLongSeconds} s once or ${THRESHOLDS.noFaceTotalSeconds} s in total`, () => {
    expect(find(evaluateRules([ev("no_face", 0), ev("face_back", 9, { awayMs: 9000 })], [], all), "no_face")).toBeUndefined();
    const flag = find(evaluateRules([ev("no_face", 0), ev("face_back", 10, { awayMs: 10_000 })], [], all), "no_face");
    expect(flag?.reason).toBe("No face in view 1 time (10 s in total, longest 10 s)");
    const many = [0, 20, 40, 60].flatMap((s) => [ev("no_face", s), ev("face_back", s + 8, { awayMs: 8000 })]);
    expect(find(evaluateRules(many, [], all), "no_face")?.reason).toBe("No face in view 4 times (32 s in total, longest 8 s)");
  });

  it("flags any moment with more than one face, with the count", () => {
    const flag = find(evaluateRules([ev("multiple_faces", 30, { faces: 3 }), ev("single_face", 35)], [], all), "multiple_faces");
    expect(flag?.reason).toBe("More than one face in view 1 time");
    expect(flag?.evidence.events[0]).toMatchObject({ kind: "multiple_faces", faces: 3 });
  });

  const speak = (fromS: number, seconds: number) => [ev("speech_started", fromS), ev("speech_stopped", fromS + seconds, { speechMs: seconds * 1000 })];

  it(`flags ${THRESHOLDS.speechCount} stretches of speech of ${THRESHOLDS.speechSeconds} s, with the audio clip as evidence`, () => {
    const two = [...speak(0, 3), ...speak(60, 5)];
    expect(find(evaluateRules(two, [], all), "speech")).toBeUndefined();
    const snaps = [media(1, "audio", 8, "speech"), media(2, "camera", 1, "interval"), media(3, "audio", 500, "speech")];
    const flag = find(evaluateRules([...two, ...speak(120, 4)], snaps, all), "speech");
    expect(flag?.reason).toBe("Speech heard 3 times (12 s in total)");
    expect(flag?.evidence.events[0]).toMatchObject({ kind: "speech_started", speechMs: 3000, endAt: at(3) });
    expect(flag?.evidence.mediaIds).toEqual(expect.arrayContaining([1, 2]));
    expect(flag?.evidence.mediaIds).not.toContain(3);
  });

  it(`flags ${THRESHOLDS.speechTotalSeconds} s of speech in total, and nothing without the microphone`, () => {
    const long = speak(0, 30);
    expect(find(evaluateRules(long, [], all), "speech")?.reason).toBe("Speech heard 1 time (30 s in total)");
    expect(find(evaluateRules(long, [], { ...all, microphone: false }), "speech")).toBeUndefined();
  });
});

describe("integrity label (severity-based)", () => {
  const f = (...ids: string[]) => ids.map((rule) => ({ rule }) as Pick<FlagDraft, "rule">);

  it("gives every rule a severity", () => {
    const ids: RuleId[] = ["left_window", "paste", "fullscreen", "screen_share", "camera", "multiple_displays", "downtime", "copy", "copy_then_leave", "gaze", "no_face", "multiple_faces", "speech"];
    for (const id of ids) expect(["high", "medium"]).toContain(RULE_SEVERITY[id]);
  });

  it("is clear without flags and review for one or two ordinary flags", () => {
    expect(integrityLabel([])).toBe("clear");
    expect(labelReasons([])).toEqual([]);
    expect(integrityLabel(f("paste"))).toBe("review");
    expect(integrityLabel(f("left_window", "gaze"))).toBe("review");
    expect(integrityLabel(f("speech", "paste"))).toBe("review");
    expect(labelReasons(f("paste")).length).toBeGreaterThan(0);
  });

  it("is suspicious for a copy then leave, or more than one face, on its own", () => {
    expect(integrityLabel(f("copy_then_leave"))).toBe("suspicious");
    expect(labelReasons(f("copy_then_leave"))).toEqual(["Copied text, then left the test window"]);
    expect(integrityLabel(f("multiple_faces"))).toBe("suspicious");
    expect(labelReasons(f("multiple_faces"))).toEqual(["More than one face was in view"]);
  });

  it("is suspicious when leaving the window comes with monitoring gaps", () => {
    for (const other of ["camera", "screen_share", "downtime", "no_face"]) expect(integrityLabel(f("left_window", other))).toBe("suspicious");
    expect(labelReasons(f("left_window", "camera"))).toEqual(["Left the test window, and the camera was turned off"]);
    expect(integrityLabel(f("camera", "downtime"))).toBe("review");
  });

  it("is suspicious when speech comes with looking away or leaving the window", () => {
    expect(integrityLabel(f("speech", "gaze"))).toBe("suspicious");
    expect(integrityLabel(f("speech", "left_window"))).toBe("suspicious");
    expect(labelReasons(f("speech", "gaze"))).toEqual(["Speech was heard, and the candidate looked away from the screen"]);
  });

  it(`is suspicious from ${THRESHOLDS.suspiciousFlags} flags of any kind`, () => {
    expect(integrityLabel(f("paste", "fullscreen", "copy"))).toBe("suspicious");
    expect(labelReasons(f("paste", "fullscreen", "copy"))).toEqual(["3 different kinds of unusual moments"]);
  });
});
