import { afterEach, describe, expect, it, vi } from "vitest";
import { MICROPHONE_MESSAGES, openMicrophone } from "@/lib/proctoring/client/media";

function stubGetUserMedia(impl: (c: MediaStreamConstraints) => Promise<unknown>) {
  const getUserMedia = vi.fn(impl);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return getUserMedia;
}

describe("openMicrophone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for audio only, with echo cancellation and no processing that hides speech", async () => {
    const stream = { id: "mic" };
    const getUserMedia = stubGetUserMedia(async () => stream);
    expect(await openMicrophone()).toEqual({ ok: true, stream });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  });

  it.each([
    ["NotAllowedError", "blocked"],
    ["SecurityError", "blocked"],
    ["NotFoundError", "none"],
    ["OverconstrainedError", "none"],
    ["NotReadableError", "failed"],
    ["AbortError", "failed"],
  ])("maps %s to %s", async (name, reason) => {
    stubGetUserMedia(async () => {
      throw Object.assign(new Error(name), { name });
    });
    expect(await openMicrophone()).toEqual({ ok: false, reason });
  });

  it("fails without getUserMedia", async () => {
    vi.stubGlobal("navigator", {});
    expect(await openMicrophone()).toEqual({ ok: false, reason: "failed" });
  });

  it("has a message for every failure", () => {
    expect(Object.keys(MICROPHONE_MESSAGES).sort()).toEqual(["blocked", "failed", "none"]);
    for (const m of Object.values(MICROPHONE_MESSAGES)) expect(m).toMatch(/\.$/);
  });
});
