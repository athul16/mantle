/**
 * Proctoring rules: browser signals and snapshots in, flags with evidence out.
 * Pure functions, no database. Nothing here rejects anyone; it only decides
 * what a recruiter should look at.
 */
import { describe, expect, it } from "vitest";
import {
  THRESHOLDS,
  evaluateRules,
  integrityLabel,
  parseSignalBatch,
  type MediaRef,
  type SignalEvent,
} from "@/lib/proctoring/rules";

const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

let nextId = 1;
function ev(kind: SignalEvent["kind"], seconds: number, payload: SignalEvent["payload"] = {}): SignalEvent {
  return { id: nextId++, at: at(seconds), kind, payload };
}
const media = (id: number, source: MediaRef["source"], seconds: number): MediaRef => ({ id, source, at: at(seconds) });
const both = { camera: true, screen: true };

describe("evaluateRules", () => {
  it("raises nothing for a clean attempt", () => {
    const flags = evaluateRules([ev("screen_share_started", 0, { surface: "monitor" }), ev("camera_started", 0)], [], both);
    expect(flags).toEqual([]);
    expect(integrityLabel(flags)).toBe("clear");
  });

  it("flags leaving the window often, with the count and total time away in the reason", () => {
    const events = [
      ev("left_window", 60),
      ev("returned_to_window", 65, { awayMs: 5_000 }),
      ev("left_window", 120),
      ev("returned_to_window", 130, { awayMs: 10_000 }),
      ev("left_window", 300),
      ev("returned_to_window", 302, { awayMs: 2_000 }),
    ];
    const flags = evaluateRules(events, [], both);
    expect(flags).toHaveLength(1);
    expect(flags[0].rule).toBe("left_window");
    expect(flags[0].reason).toBe("Left the test window 3 times (17 s away in total)");
    expect(flags[0].evidence.events.map((e) => e.kind)).toEqual(["left_window", "left_window", "left_window"]);
    expect(flags[0].evidence.events[1]).toMatchObject({ at: at(120), awayMs: 10_000 });
  });

  it("does not flag one short look away", () => {
    const flags = evaluateRules([ev("left_window", 60), ev("returned_to_window", 63, { awayMs: 3_000 })], [], both);
    expect(flags).toEqual([]);
  });

  it("flags a single long absence", () => {
    const flags = evaluateRules(
      [ev("left_window", 60), ev("returned_to_window", 60 + THRESHOLDS.longAwaySeconds, { awayMs: THRESHOLDS.longAwaySeconds * 1000 })],
      [],
      both,
    );
    expect(flags.map((f) => f.rule)).toEqual(["left_window"]);
    expect(flags[0].reason).toBe(`Left the test window 1 time (${THRESHOLDS.longAwaySeconds} s away in total)`);
  });

  it("counts a window that was never returned to as still away (no awayMs)", () => {
    const flags = evaluateRules([ev("left_window", 10), ev("left_window", 20), ev("left_window", 30)], [], both);
    expect(flags[0].reason).toBe("Left the test window 3 times");
  });

  it("flags pasting a lot of text, but not a couple of small pastes", () => {
    expect(evaluateRules([ev("pasted", 10, { chars: 12 }), ev("pasted", 20, { chars: 8 })], [], both)).toEqual([]);
    const flags = evaluateRules([ev("pasted", 10, { chars: 150 }), ev("pasted", 20, { chars: 90 })], [], both);
    expect(flags.map((f) => f.rule)).toEqual(["paste"]);
    expect(flags[0].reason).toBe("Pasted text 2 times (240 characters)");
  });

  it("flags many pastes even when they are short", () => {
    const flags = evaluateRules(
      Array.from({ length: THRESHOLDS.pasteCount }, (_, n) => ev("pasted", n * 10, { chars: 4 })),
      [],
      both,
    );
    expect(flags.map((f) => f.rule)).toEqual(["paste"]);
  });

  it("flags leaving full screen from the second exit", () => {
    expect(evaluateRules([ev("fullscreen_exited", 10)], [], both)).toEqual([]);
    const flags = evaluateRules([ev("fullscreen_exited", 10), ev("fullscreen_exited", 50)], [], both);
    expect(flags.map((f) => f.rule)).toEqual(["fullscreen"]);
    expect(flags[0].reason).toBe("Left full screen 2 times");
  });

  it("flags a stopped or refused screen share and sharing something other than the whole screen", () => {
    const stopped = evaluateRules([ev("screen_share_stopped", 100)], [], both);
    expect(stopped.map((f) => f.rule)).toEqual(["screen_share"]);
    expect(stopped[0].reason).toBe("Screen sharing stopped 1 time");

    const wrong = evaluateRules([ev("screen_share_wrong_surface", 5, { surface: "browser" })], [], both);
    expect(wrong[0].reason).toBe("Tried to share a window or tab instead of the entire screen");
  });

  it("ignores screen and camera signals when the assessment does not use them", () => {
    const flags = evaluateRules([ev("screen_share_stopped", 100), ev("camera_stopped", 120)], [], { camera: false, screen: false });
    expect(flags).toEqual([]);
  });

  it("flags the camera turning off and a second display", () => {
    const flags = evaluateRules([ev("camera_stopped", 100), ev("multiple_displays", 0)], [], both);
    expect(flags.map((f) => f.rule).sort()).toEqual(["camera", "multiple_displays"]);
    expect(flags.find((f) => f.rule === "multiple_displays")!.reason).toBe("A second display was connected");
  });

  it("attaches the nearest camera and screen snapshots to each piece of evidence", () => {
    const snaps = [
      media(1, "camera", 0),
      media(2, "screen", 0),
      media(3, "camera", 125), // nearest camera to the stop at 130
      media(4, "screen", 140), // nearest screen
      media(5, "camera", 1000), // too far away
    ];
    const flags = evaluateRules([ev("screen_share_stopped", 130)], snaps, both);
    expect(flags[0].evidence.mediaIds).toEqual([3, 4]);
  });

  it("keeps evidence short: at most 20 events and 6 snapshots", () => {
    const events = Array.from({ length: 40 }, (_, n) => ev("left_window", n * 30));
    const snaps = Array.from({ length: 40 }, (_, n) => media(100 + n, n % 2 ? "camera" : "screen", n * 30));
    const [flag] = evaluateRules(events, snaps, both);
    expect(flag.evidence.events).toHaveLength(20);
    expect(flag.evidence.total).toBe(40);
    expect(flag.evidence.mediaIds.length).toBeLessThanOrEqual(6);
  });
});

describe("integrityLabel", () => {
  const flag = (rule: string) => ({ rule, reason: rule, evidence: { events: [], mediaIds: [], total: 0 } }) as never;
  it("is clear with no flags, review with one or two, suspicious from three", () => {
    expect(integrityLabel([])).toBe("clear");
    expect(integrityLabel([flag("paste")])).toBe("review");
    expect(integrityLabel([flag("paste"), flag("fullscreen")])).toBe("review");
    expect(integrityLabel([flag("paste"), flag("fullscreen"), flag("left_window")])).toBe("suspicious");
  });
});

describe("parseSignalBatch", () => {
  const now = new Date(T0 + 600_000);

  it("keeps known kinds with clean payloads and drops the rest", () => {
    const parsed = parseSignalBatch(
      {
        signals: [
          { kind: "left_window", at: at(590) },
          { kind: "pasted", at: at(591), chars: 42, text: "secret answer" },
          { kind: "returned_to_window", at: at(592), awayMs: 2000 },
          { kind: "screen_share_started", at: at(593), surface: "monitor" },
          { kind: "consented_to_monitoring", at: at(594) }, // server-only kind
          { kind: "made_up", at: at(595) },
          "nonsense",
        ],
      },
      now,
    );
    expect(parsed).toEqual([
      { kind: "left_window", at: at(590), payload: {} },
      { kind: "pasted", at: at(591), payload: { chars: 42 } },
      { kind: "returned_to_window", at: at(592), payload: { awayMs: 2000 } },
      { kind: "screen_share_started", at: at(593), payload: { surface: "monitor" } },
    ]);
  });

  it("never stores pasted text, only its length", () => {
    const [p] = parseSignalBatch({ signals: [{ kind: "pasted", at: at(1), chars: 5, text: "abcde" }] }, now);
    expect(JSON.stringify(p)).not.toContain("abcde");
  });

  it("clamps timestamps from the future or the distant past to the server clock", () => {
    const [future, past, missing] = parseSignalBatch(
      {
        signals: [
          { kind: "left_window", at: new Date(T0 + 3_600_000).toISOString() },
          { kind: "left_window", at: "2001-01-01T00:00:00.000Z" },
          { kind: "left_window" },
        ],
      },
      now,
    );
    expect(future.at).toBe(now.toISOString());
    expect(past.at).toBe(now.toISOString());
    expect(missing.at).toBe(now.toISOString());
  });

  it("accepts at most 50 signals per batch and rejects non-batches", () => {
    const many = { signals: Array.from({ length: 80 }, () => ({ kind: "copied", at: at(1), chars: 1 })) };
    expect(parseSignalBatch(many, now)).toHaveLength(50);
    expect(parseSignalBatch(null, now)).toEqual([]);
    expect(parseSignalBatch({ signals: "x" }, now)).toEqual([]);
  });

  it("limits surface to the values browsers report", () => {
    const [s] = parseSignalBatch({ signals: [{ kind: "screen_share_wrong_surface", at: at(1), surface: "<script>" }] }, now);
    expect(s.payload).toEqual({ surface: "unknown" });
  });
});
