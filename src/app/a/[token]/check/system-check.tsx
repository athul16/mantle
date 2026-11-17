"use client";

import Link from "next/link";
import { enterFullscreen } from "@/lib/candidate/fullscreen";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { isMonitored, monitoringNotice, type MonitoringSettings, type Proctoring } from "@/lib/proctoring/config";
import { createAudioMonitor } from "@/lib/proctoring/client/audio";
import { createGazeMonitor } from "@/lib/proctoring/client/gaze";
import { CAMERA_MESSAGES, MICROPHONE_MESSAGES, SCREEN_MESSAGES, canShareScreen, openCamera, openMicrophone, openScreen } from "@/lib/proctoring/client/media";
import { CameraPreview } from "@/lib/proctoring/client/proctoring";
import { holdMedia } from "@/lib/proctoring/client/media-store";
import { makeSignal, sendSignals } from "@/lib/proctoring/client/signals";
import { takeSnapshot } from "@/lib/proctoring/client/snapshots";

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 600;
/** How long the sound check listens before the candidate may continue anyway. */
const SOUND_CHECK_MS = 10_000;
const GAZE_NOTE = "Your device couldn't run the facing-the-screen check; your camera is still on.";
const OFF: Proctoring = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false};

interface CheckResult {
  desktop: boolean;
  screenOk: boolean;
  width: number;
  height: number;
  browser: string;
}

/** "Chrome 130", "Edge 130", "Firefox 132", "Safari 18", or "Your browser". */
function browserName(ua: string): string {
  const m =
    /Edg\/(\d+)/.exec(ua) ? ["Edge", /Edg\/(\d+)/.exec(ua)![1]] :
    /Firefox\/(\d+)/.exec(ua) ? ["Firefox", /Firefox\/(\d+)/.exec(ua)![1]] :
    /Chrome\/(\d+)/.exec(ua) ? ["Chrome", /Chrome\/(\d+)/.exec(ua)![1]] :
    /Version\/(\d+).*Safari/.exec(ua) ? ["Safari", /Version\/(\d+)/.exec(ua)![1]] :
    null;
  return m ? `${m[0]} ${m[1]}` : "Your browser";
}

function runChecks(): CheckResult {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  const mobile = uaData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const width = window.screen.width;
  const height = window.screen.height;
  return { desktop: !mobile, screenOk: width >= MIN_WIDTH && height >= MIN_HEIGHT, width, height, browser: browserName(navigator.userAgent) };
}

let cached: CheckResult | null = null;
const subscribe = (onChange: () => void) => {
  const handler = () => {
    cached = runChecks();
    onChange();
  };
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
};
const getSnapshot = () => (cached ??= runChecks());
const getServerSnapshot = () => null;
const noSubscribe = () => () => {};

type Device = { state: "idle" | "pending" | "pass" | "fail"; detail?: string; reason?: string };
type RowState = "pending" | "pass" | "fail" | "warn" | "todo";
/** `optional`: shown, but doesn't hold back Continue (e.g. the sound check after its wait). */
type Row = { label: string; detail: string; state: RowState; optional?: boolean };

const record = (kind: Parameters<typeof makeSignal>[0], payload?: Parameters<typeof makeSignal>[1]) =>
  void sendSignals([makeSignal(kind, payload)]).catch(() => {});

/**
 * Setup check (prototype vCheck()): browser, screen size and connection, then,
 * when the assessment uses them, a live camera with a start photo and an
 * entire-screen share, and the microphone with a short sound check. Consent to monitoring is normally given on the verify
 * page; if it wasn't recorded (an older session), the notice and an agree box
 * come first. Nothing is requested from the browser before that. The camera,
 * screen and microphone streams are kept for the workspace (client
 * navigation). With the gaze check on, a trial run warms the model and shows a
 * note early if the device can't run it; it never blocks.
 */
export function SystemCheck({
  token,
  proctoring = OFF,
  consented = false,
  companyName = "the company",
  autoFullscreen = true,
}: {
  token: string;
  proctoring?: MonitoringSettings;
  consented?: boolean;
  companyName?: string;
  /** Go full screen on Continue (off when the candidate is excused from full screen). */
  autoFullscreen?: boolean;
}) {
  const result = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const screenSupported = useSyncExternalStore(noSubscribe, canShareScreen, () => true);
  const monitored = isMonitored(proctoring);
  const [agreed, setAgreed] = useState(consented);
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [camera, setCamera] = useState<Device>({ state: "idle" });
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<"none" | "taking" | "taken" | "failed">("none");
  const [screen, setScreen] = useState<Device>({ state: "idle" });
  const [mic, setMic] = useState<Device>({ state: "idle" });
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [sound, setSound] = useState<"listening" | "heard" | "silent">("listening");
  const [gazeNote, setGazeNote] = useState(false);
  const micStarted = useRef(false);
  const [online, setOnline] = useState<"pending" | "ok" | "fail">("pending");
  const started = useRef(false);

  async function agree() {
    setSaving(true);
    setConsentError(null);
    try {
      const res = await fetch("/api/candidate/proctoring/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agree: true }),
      });
      if (res.ok) setAgreed(true);
      else setConsentError("Couldn't save your agreement. Try again.");
    } catch {
      setConsentError("Couldn't save your agreement. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function testCamera() {
    setCamera({ state: "pending" });
    const r = await openCamera();
    if (!r.ok) {
      if (r.reason === "blocked") record("camera_refused");
      setCamera({ state: "fail", detail: CAMERA_MESSAGES[r.reason], reason: r.reason });
      return;
    }
    holdMedia("camera", r.stream);
    setCameraStream(r.stream);
    setCamera({ state: "pass" });
  }

  async function takePhoto() {
    if (!cameraStream) return;
    setPhoto("taking");
    setPhoto((await takeSnapshot("camera", cameraStream, "start")) ? "taken" : "failed");
  }

  async function testMicrophone() {
    setMic({ state: "pending" });
    const r = await openMicrophone();
    if (!r.ok) {
      if (r.reason === "blocked") record("microphone_refused");
      setMic({ state: "fail", detail: MICROPHONE_MESSAGES[r.reason], reason: r.reason });
      return;
    }
    holdMedia("microphone", r.stream);
    record("microphone_started");
    setSound("listening");
    setMicStream(r.stream);
    setMic({ state: "pass" });
  }

  async function shareScreen() {
    setScreen({ state: "pending" });
    const r = await openScreen();
    if (!r.ok) {
      if (r.reason === "wrong_surface") record("screen_share_wrong_surface", { surface: r.surface });
      if (r.reason === "cancelled") record("screen_share_refused");
      setScreen({ state: "fail", detail: SCREEN_MESSAGES[r.reason], reason: r.reason });
      return;
    }
    holdMedia("screen", r.stream);
    record("screen_share_started", { surface: r.surface });
    setScreen({ state: "pass" });
  }

  // Connection: one round trip to our own server.
  useEffect(() => {
    let live = true;
    fetch("/api/health", { cache: "no-store" })
      .then(() => live && setOnline("ok"))
      .catch(() => live && setOnline("fail"));
    return () => {
      live = false;
    };
  }, []);

  // The camera starts on its own once the candidate has agreed (as in the prototype).
  useEffect(() => {
    if (!proctoring.camera || !agreed || started.current) return;
    started.current = true;
    void Promise.resolve().then(testCamera);
  }, [proctoring.camera, agreed]);

  // The microphone starts on its own once the candidate has agreed, like the camera.
  useEffect(() => {
    if (!proctoring.microphone || !agreed || micStarted.current) return;
    micStarted.current = true;
    void Promise.resolve().then(testMicrophone);
  }, [proctoring.microphone, agreed]);

  // Sound check: a throwaway speech monitor (nothing uploaded); hearing speech
  // passes it, and after SOUND_CHECK_MS the candidate may continue anyway.
  useEffect(() => {
    if (!micStream) return;
    let done = false;
    const monitor = createAudioMonitor({
      stream: micStream,
      upload: async () => true,
      onSignal: (kind) => {
        if (kind !== "speech_started" || done) return;
        done = true;
        clearTimeout(timer);
        setSound("heard");
        void monitor.stop();
      },
    });
    const timer = setTimeout(() => {
      if (!done) setSound("silent");
    }, SOUND_CHECK_MS);
    monitor.start();
    return () => {
      done = true;
      clearTimeout(timer);
      void monitor.stop();
    };
  }, [micStream]);

  // Gaze warm-up: one trial start/stop on the camera loads the model early.
  useEffect(() => {
    if (!proctoring.gaze || !cameraStream) return;
    let cancelled = false;
    const monitor = createGazeMonitor({ stream: cameraStream, onSignal: () => {} });
    void monitor.start().then((result) => {
      monitor.stop();
      if (!cancelled && result !== "ok") setGazeNote(true);
    });
    return () => {
      cancelled = true;
      monitor.stop();
    };
  }, [proctoring.gaze, cameraStream]);

  const unsupported = proctoring.screen && !screenSupported;
  const rows: Row[] = [
    {
      label: "Browser",
      state: result === null ? "pending" : result.desktop ? "pass" : "fail",
      detail: result === null ? "Checking…" : result.desktop ? result.browser : "Phones and tablets can't run the simulation. Reopen the link on a computer.",
    },
    {
      label: "Screen",
      state: result === null ? "pending" : result.screenOk ? "pass" : "fail",
      detail: result === null ? "Checking…" : `${result.width} × ${result.height} · at least ${MIN_WIDTH} × ${MIN_HEIGHT} needed`,
    },
    {
      label: "Connection",
      state: online === "pending" ? "pending" : online === "ok" ? "pass" : "fail",
      detail: online === "pending" ? "Checking…" : online === "ok" ? "Stable" : "Offline. Check your internet connection.",
    },
  ];
  if (proctoring.camera) {
    rows.push({
      label: "Camera",
      state: !agreed ? "todo" : camera.state === "idle" ? "pending" : camera.state,
      detail: !agreed ? "Waiting for your agreement" : camera.state === "pass" ? "Allowed" : camera.state === "fail" ? camera.detail! : "Checking…",
    });
  }
  if (proctoring.microphone) {
    rows.push({
      label: "Microphone",
      state: !agreed ? "todo" : mic.state === "idle" ? "pending" : mic.state,
      detail: !agreed ? "Waiting for your agreement" : mic.state === "pass" ? "Allowed" : mic.state === "fail" ? mic.detail! : "Checking…",
    });
    if (mic.state === "pass") {
      rows.push({
        label: "Sound check",
        state: sound === "heard" ? "pass" : sound === "silent" ? "warn" : "todo",
        optional: sound === "silent",
        detail:
          sound === "heard"
            ? "We heard you"
            : sound === "silent"
              ? "We didn't hear anything. Check your microphone isn't muted; you can still continue."
              : "Say a few words out loud",
      });
    }
  }
  if (proctoring.screen) {
    rows.push({
      label: "Screen sharing",
      state: unsupported ? "fail" : screen.state === "pass" ? "pass" : screen.reason === "wrong_surface" ? "warn" : screen.state === "pending" ? "pending" : "todo",
      detail: unsupported
        ? "Not supported in this browser"
        : screen.state === "pass"
          ? "Entire screen shared"
          : screen.reason === "wrong_surface"
            ? "You shared a window or tab"
            : "Not shared yet",
    });
  }
  if (proctoring.camera) {
    rows.push({
      label: "Start photo",
      state: photo === "taken" ? "pass" : photo === "taking" ? "pending" : photo === "failed" ? "fail" : "todo",
      detail: photo === "taken" ? "Taken" : photo === "taking" ? "Saving…" : photo === "failed" ? "Couldn't save it. Take it again." : "Not taken yet",
    });
  }

  const running = rows.some((r) => r.state === "pending");
  const left = rows.filter((r) => r.state !== "pass" && !r.optional).length;
  const passed = left === 0 && (!monitored || agreed);
  const sub = result === null || running ? "Running checks…" : left === 0 ? "All set. You can continue." : left === 1 ? "One item left." : `${left} items left.`;

  return (
    <>
      <div>
        <h1 style={{ fontSize: 24 }}>Check your setup</h1>
        <p className="ink2" style={{ marginTop: 4 }} aria-live="polite">
          {sub}
        </p>
      </div>

      {monitored && !agreed ? (
        <section aria-labelledby="monitoring-heading" className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="monitoring-heading" style={{ fontSize: 18 }}>
            Monitoring for this test
          </h2>
          {monitoringNotice(proctoring, companyName).map((p) => (
            <p key={p} className="small ink2">
              {p}
            </p>
          ))}
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              className="chk"
              style={{ marginTop: 2 }}
              checked={saving}
              disabled={saving}
              onChange={(e) => {
                if (e.target.checked) void agree();
              }}
            />
            <span className="small strong">{consentLabel(proctoring)}</span>
          </label>
          {consentError ? <p className="small badc">{consentError}</p> : null}
        </section>
      ) : null}

      <div className="row g20 wrap" style={{ alignItems: "flex-start" }}>
        {proctoring.camera ? (
          <section style={{ flex: "3 1 400px", display: "flex", flexDirection: "column", gap: 12 }} aria-label="Camera">
            <CameraPanel camera={camera} stream={cameraStream} agreed={agreed} photo={photo} onRetry={() => void testCamera()} />
            {camera.state === "pass" ? (
              <div className="row g12 wrap">
                <button type="button" className="btn" disabled={photo === "taking"} onClick={() => void takePhoto()}>
                  <Icon name="camera" />
                  {photo === "taken" ? "Retake photo" : "Take start photo"}
                </button>
                <span className="small muted">Used to confirm the same person finishes the simulation.</span>
              </div>
            ) : null}
          </section>
        ) : null}
        <ul className="card" style={{ flex: "2 1 280px", overflow: "hidden", listStyle: "none", padding: 0, margin: 0 }} aria-label="System checks">
          {rows.map((r) => (
            <li key={r.label} className={`chkrow${r.state === "warn" ? " warn" : r.state === "fail" ? " fail" : ""}`}>
              <StatusIcon state={r.state} />
              <span style={{ flex: 1 }}>
                <span className="strong">{r.label}</span> <span className="ink2">· {r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {proctoring.microphone && mic.state === "fail" ? (
        <section className="card" style={{ padding: "18px 20px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }} aria-label="Microphone">
          <div style={{ flex: "1 1 280px" }}>
            <h2 style={{ fontSize: 16 }}>
              <Icon name="mic" /> Turn on your microphone
            </h2>
            <p className="small badc" style={{ marginTop: 4 }} role="alert">
              {mic.detail}
            </p>
          </div>
          <button type="button" className="btn btn-dark" onClick={() => void testMicrophone()}>
            <Icon name="refresh" />
            Turn on microphone
          </button>
        </section>
      ) : null}

      {gazeNote ? (
        <p role="note" className="row g8 small ink2" style={{ alignItems: "flex-start" }}>
          <Icon name="info" className="i-sm" />
          <span>{GAZE_NOTE}</span>
        </p>
      ) : null}

      {proctoring.screen && screen.state !== "pass" ? (
        <ScreenShare
          state={screen}
          unsupported={unsupported}
          disabled={!agreed || screen.state === "pending"}
          onShare={() => void shareScreen()}
        />
      ) : null}

      <div className="row g16 wrap">
        {passed ? (
          <Link href={`/a/${token}/instructions`} className="btn btn-dark btn-lg" onClick={autoFullscreen ? enterFullscreen : undefined}>
            Continue
            <Icon name="arrowR" />
          </Link>
        ) : (
          <>
            <button type="button" className="btn btn-dark btn-lg" disabled>
              Continue
              <Icon name="arrowR" />
            </button>
            {result !== null && !running ? (
              <span className="small muted">
                {monitored && !agreed ? "Read and agree to the monitoring notice to continue" : "Finish the remaining checks to continue"}
              </span>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/** What the candidate agrees to, named from what this assessment actually captures. */
export function consentLabel(p: Proctoring): string {
  const parts = [p.camera ? "camera" : null, p.screen ? "screen" : null, p.microphone ? "microphone" : null].filter(Boolean) as string[];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
  return `I agree to ${list ? `${list} monitoring` : "monitoring"} for this test, as described above.`;
}

function StatusIcon({ state }: { state: RowState }) {
  if (state === "pass")
    return (
      <span className="okc row" aria-label="Passed" role="img">
        <Icon name="checkc" />
      </span>
    );
  if (state === "fail")
    return (
      <span className="badc row" aria-label="Problem" role="img">
        <Icon name="xc" />
      </span>
    );
  if (state === "warn")
    return (
      <span className="warnc row" aria-label="Needs attention" role="img">
        <Icon name="alert" />
      </span>
    );
  if (state === "pending")
    return (
      <span className="muted row" style={{ width: 16, justifyContent: "center" }} aria-label="Checking" role="img">
        <span className="spin" style={{ width: 13, height: 13 }} />
      </span>
    );
  return (
    <span className="muted row" aria-label="To do" role="img">
      <Icon name="circle" />
    </span>
  );
}

function CameraPanel({
  camera,
  stream,
  agreed,
  photo,
  onRetry,
}: {
  camera: Device;
  stream: MediaStream | null;
  agreed: boolean;
  photo: "none" | "taking" | "taken" | "failed";
  onRetry: () => void;
}) {
  if (camera.state === "pass" && stream) {
    return (
      <div className="campanel">
        <CameraPreview stream={stream} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
        <span className="camoval" style={{ position: "relative" }} aria-hidden="true" />
        <span className="campill">
          <span className="dot" style={{ color: "#6FD49B" }} />
          Camera working
        </span>
        {photo === "taken" ? (
          <span className="campill" style={{ left: "auto", right: 12, background: "rgba(27,106,58,.9)" }}>
            <Icon name="check" className="i-sm" />
            Start photo taken
          </span>
        ) : null}
        <span className="small" style={{ position: "absolute", bottom: 14, color: "#E4E8EC", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
          Center your face in the oval
        </span>
      </div>
    );
  }
  if (camera.state === "fail") {
    return (
      <div className="campanel" style={{ alignItems: "flex-start", justifyContent: "flex-start" }} role="alert">
        <div className="camblock">
          <span className="row g8" style={{ color: "#FFB4AC", fontWeight: 600 }}>
            <Icon name="videoOff" />
            {camera.reason === "blocked" ? "Your browser blocked the camera" : "Your camera isn't working"}
          </span>
          {camera.reason === "blocked" ? (
            <ol>
              <li>Click the camera icon at the right end of the address bar.</li>
              <li>
                Choose <strong>Always allow</strong>, then <strong>Done</strong>.
              </li>
              <li>
                Press <strong>Try again</strong>.
              </li>
            </ol>
          ) : (
            <p style={{ color: "#D3D9E0", fontSize: 14 }}>{camera.detail}</p>
          )}
          <div className="row g12 wrap">
            <button type="button" className="btn" onClick={onRetry}>
              <Icon name="refresh" />
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="campanel">
      {agreed ? (
        <span className="row g8 small">
          <span className="spin" />
          Starting your camera…
        </span>
      ) : (
        <span className="small" style={{ color: "#AEB7C2" }}>
          Your camera starts after you agree to monitoring.
        </span>
      )}
    </div>
  );
}

function ScreenShare({ state, unsupported, disabled, onShare }: { state: Device; unsupported: boolean; disabled: boolean; onShare: () => void }) {
  if (state.reason === "wrong_surface") {
    return (
      <section style={{ padding: "18px 20px", border: "1px solid var(--warn-line)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 14 }} aria-label="Screen sharing">
        <div>
          <h2 style={{ fontSize: 16 }}>Share your entire screen</h2>
          <p className="small ink2" style={{ marginTop: 2 }}>
            You shared a window or tab. In the browser&apos;s picker, choose <strong>Entire screen</strong>:
          </p>
        </div>
        <div className="picker" aria-hidden="true">
          <div className="yes">
            <span className="ph" style={{ height: 64 }} />
            <span className="small strong okc row g6">
              <Icon name="check" className="i-sm" />
              Entire screen
            </span>
          </div>
          <div className="no">
            <span className="ph" style={{ height: 64 }} />
            <span className="small muted row g6">
              <Icon name="x" className="i-sm" />
              Window
            </span>
          </div>
          <div className="no">
            <span className="ph" style={{ height: 64 }} />
            <span className="small muted row g6">
              <Icon name="x" className="i-sm" />
              Browser tab
            </span>
          </div>
        </div>
        <div>
          <button type="button" className="btn btn-dark btn-sm" disabled={disabled} onClick={onShare}>
            Share again
          </button>
        </div>
      </section>
    );
  }
  const note: ReactNode = unsupported ? SCREEN_MESSAGES.unsupported : state.state === "fail" ? state.detail : null;
  return (
    <section className="card" style={{ padding: "18px 20px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }} aria-label="Screen sharing">
      <span className="ovicon" style={{ background: "var(--subtle)", color: "var(--ink-2)", width: 40, height: 40 }}>
        <Icon name="monitor" />
      </span>
      <div style={{ flex: "1 1 280px" }}>
        <h2 style={{ fontSize: 16 }}>Share your entire screen</h2>
        <p className="small ink2">
          When your browser asks, choose <strong>Entire screen</strong>, not a window or tab.
        </p>
        {note ? (
          <p className="small badc" style={{ marginTop: 4 }} role="alert">
            {note}
          </p>
        ) : null}
      </div>
      {unsupported ? null : (
        <button type="button" className="btn btn-dark" disabled={disabled} onClick={onShare}>
          {state.state === "pending" ? "Waiting for your browser…" : "Share entire screen"}
        </button>
      )}
    </section>
  );
}
