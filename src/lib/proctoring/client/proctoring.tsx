"use client";

import { enterFullscreen, fullscreenSupported } from "@/lib/candidate/fullscreen";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { SNAPSHOT_INTERVAL_MS, isMonitored, type Proctoring as Settings, type SnapshotSource } from "../config";
import { createAudioMonitor, type AudioMonitor } from "./audio";
import { createAwayCapture, type AwayCapture } from "./away-capture";
import { createGazeMonitor } from "./gaze";
import { CAMERA_MESSAGES, MICROPHONE_MESSAGES, SCREEN_MESSAGES, openCamera, openMicrophone, openScreen } from "./media";
import { dropMedia, heldMedia, holdMedia, stopStream } from "./media-store";
import { takeSnapshot } from "./snapshots";
import { useBrowserSignals, type Signal } from "./use-browser-signals";

/**
 * Monitoring around the workspace (docs/02, docs/04):
 * - browser signals always (leaving the window, full screen, copy/cut/paste);
 * - with camera, screen and/or microphone on, the workspace stays covered
 *   until each is running; snapshots go up every SNAPSHOT_INTERVAL_MS, away
 *   captures run while the candidate is in another window, the microphone
 *   monitor records short clips when it hears speech, and losing any of them
 *   brings the cover back;
 * - with full screen required, the task is covered whenever the page isn't in
 *   full screen (where the browser has a Fullscreen API);
 * - with gaze on, an on-device facing-the-screen check runs on the camera.
 *   It never blocks the task.
 *
 * The cover blocks the page; the server timer keeps running (D4: it never
 * pauses). The server records each down period (and each full-screen gap from
 * fullscreen_exited to fullscreen_entered) and the report shows the gaps.
 */

type DeviceState = { on: boolean; message?: string; starting?: boolean };

const STOPPED = {
  camera: "Your camera turned off. Turn it back on to continue.",
  screen: "Screen sharing stopped. Share your entire screen again to continue.",
  microphone: "Your microphone turned off. Turn it back on to continue.",
};

/** Uploaded speech clips per workspace visit. */
const MAX_AUDIO_CLIPS = 300;

const GAZE_NOTE = "Your device couldn't run the facing-the-screen check; your camera is still on.";
const FULLSCREEN_NOTE = "This browser doesn't support full screen, so the test runs in the window.";

const noSubscribe = () => () => {};
const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};
const isFullscreen = () => !!document.fullscreenElement;


/**
 * `inlineIndicators`: the page shows <ProctoringIndicators /> itself (the
 * workspace header does); otherwise a small floating status card is shown.
 */
export function Proctoring({ settings, children, inlineIndicators = false }: { settings: Settings; children: ReactNode; inlineIndicators?: boolean }) {
  const monitored = isMonitored(settings);
  const streams = useRef<Partial<Record<SnapshotSource, MediaStream>>>({});
  const micStream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioMonitor | null>(null);
  const awayCapture = useRef<AwayCapture | null>(null);
  const [camera, setCamera] = useState<DeviceState>(() => ({ on: !!(settings.camera && heldMedia("camera")) }));
  const [screen, setScreen] = useState<DeviceState>(() => ({ on: !!(settings.screen && heldMedia("screen")) }));
  const [mic, setMic] = useState<DeviceState>(() => ({ on: !!(settings.microphone && heldMedia("microphone")) }));
  // Bumped each time the microphone is (re)opened here, so the start effect runs
  // for the new monitor. A held stream's monitor is made on mount, before that effect.
  const [micGeneration, setMicGeneration] = useState(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(() => (settings.camera ? (heldMedia("camera") ?? null) : null));
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  const canFullscreen = useSyncExternalStore(noSubscribe, fullscreenSupported, () => true);
  const [enteredFullscreen, setEnteredFullscreen] = useState(false);
  // Start goes full screen before the workspace mounts, so no fullscreen_entered
  // signal arrives here; being in full screen at all counts as having entered it.
  if (fullscreen && !enteredFullscreen) setEnteredFullscreen(true);
  const [gazeNote, setGazeNote] = useState(false);
  const [notesDismissed, setNotesDismissed] = useState(false);

  const snapshot = useCallback(() => {
    for (const source of ["camera", "screen"] as const) {
      const s = streams.current[source];
      if (s && s.getVideoTracks().some((t) => t.readyState === "live")) void takeSnapshot(source, s, "interval");
    }
  }, []);

  const onSignal = useCallback((s: Signal) => {
    if (s.kind === "left_window") awayCapture.current?.left();
    else if (s.kind === "returned_to_window") awayCapture.current?.returned();
    else if (s.kind === "fullscreen_entered") setEnteredFullscreen(true);
  }, []);
  const { record } = useBrowserSignals({ onSignal });

  // Wires a camera or screen stream in: keep it, watch for it ending.
  const attach = useCallback(
    (source: SnapshotSource, stream: MediaStream) => {
      streams.current[source] = stream;
      holdMedia(source, stream);
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (streams.current[source] !== stream) return;
        delete streams.current[source];
        dropMedia(source);
        if (source === "camera") {
          setPreviewStream(null);
          setCamera({ on: false, message: STOPPED.camera });
          record("camera_stopped");
        } else {
          setScreen({ on: false, message: STOPPED.screen });
          record("screen_share_stopped");
        }
      });
    },
    [record],
  );

  const micLost = useCallback(
    (stream: MediaStream) => {
      if (micStream.current !== stream) return;
      micStream.current = null;
      dropMedia("microphone");
      const monitor = audio.current;
      audio.current = null;
      void monitor?.stop();
      setMic({ on: false, message: STOPPED.microphone });
      record("microphone_stopped");
    },
    [record],
  );

  // Wires a microphone stream in: a fresh speech monitor, and the cover if it ends.
  const attachMic = useCallback(
    (stream: MediaStream) => {
      micStream.current = stream;
      holdMedia("microphone", stream);
      void audio.current?.stop();
      audio.current = createAudioMonitor({
        stream,
        maxClips: MAX_AUDIO_CLIPS,
        onSignal: (kind, payload) => {
          // The track listener below records the loss once.
          if (kind === "microphone_stopped") micLost(stream);
          else record(kind, payload ?? {});
        },
      });
      stream.getAudioTracks()[0]?.addEventListener("ended", () => micLost(stream));
    },
    [micLost, record],
  );

  const startCamera = useCallback(async () => {
    setCamera((c) => ({ ...c, starting: true }));
    const result = await openCamera();
    if (!result.ok) {
      if (result.reason === "blocked") record("camera_refused");
      setCamera({ on: false, message: CAMERA_MESSAGES[result.reason] });
      return;
    }
    attach("camera", result.stream);
    setPreviewStream(result.stream);
    record("camera_started");
    setCamera({ on: true });
  }, [attach, record]);

  const startScreen = useCallback(async () => {
    setScreen((s) => ({ ...s, starting: true }));
    const result = await openScreen();
    if (!result.ok) {
      if (result.reason === "wrong_surface") record("screen_share_wrong_surface", { surface: result.surface });
      if (result.reason === "cancelled") record("screen_share_refused");
      setScreen({ on: false, message: SCREEN_MESSAGES[result.reason] });
      return;
    }
    attach("screen", result.stream);
    record("screen_share_started", { surface: result.surface });
    setScreen({ on: true });
  }, [attach, record]);

  const startMicrophone = useCallback(async () => {
    setMic((m) => ({ ...m, starting: true }));
    const result = await openMicrophone();
    if (!result.ok) {
      if (result.reason === "blocked") record("microphone_refused");
      setMic({ on: false, message: MICROPHONE_MESSAGES[result.reason] });
      return;
    }
    attachMic(result.stream);
    setMicGeneration((g) => g + 1);
    record("microphone_started");
    setMic({ on: true });
  }, [attachMic, record]);

  // On mount: reuse streams from the system check, or start the camera and
  // microphone (no click needed once allowed). Away captures for this visit.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (settings.camera) {
      const held = heldMedia("camera");
      if (held) attach("camera", held);
      // Next tick, and cancelled on unmount, so a double-mounted effect asks once.
      else timers.push(setTimeout(() => void startCamera(), 0));
    }
    if (settings.screen) {
      const held = heldMedia("screen");
      if (held) attach("screen", held);
    }
    if (settings.microphone) {
      const held = heldMedia("microphone");
      if (held) attachMic(held);
      else timers.push(setTimeout(() => void startMicrophone(), 0));
    }
    const capture = monitored ? createAwayCapture({ getStream: (s) => streams.current[s] }) : null;
    awayCapture.current = capture;
    return () => {
      timers.forEach(clearTimeout);
      capture?.stop();
      if (awayCapture.current === capture) awayCapture.current = null;
      // Leaving the workspace (review, done) ends listening; the microphone
      // is opened again if the candidate comes back.
      const monitor = audio.current;
      audio.current = null;
      void monitor?.stop();
      const stream = micStream.current;
      micStream.current = null;
      if (stream) {
        dropMedia("microphone");
        stopStream(stream);
      }
    };
    // Run once per mount; settings don't change during an attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devicesActive = (!settings.camera || camera.on) && (!settings.screen || screen.on) && (!settings.microphone || mic.on);
  const fullscreenRequired = settings.fullscreen && canFullscreen;
  const active = devicesActive && (!fullscreenRequired || fullscreen);

  // Snapshots while the devices are running: one now, then on the interval.
  // They keep going while only full screen is missing.
  useEffect(() => {
    if (!monitored || !devicesActive) return;
    snapshot();
    const timer = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [devicesActive, monitored, snapshot]);

  // Speech monitor: listens once monitoring is running (start() is idempotent).
  // Declared after the mount effect, so a held stream's monitor already exists.
  useEffect(() => {
    if (devicesActive) audio.current?.start();
  }, [devicesActive, micGeneration]);

  // On-device gaze check on the current camera stream; a new stream gets a new monitor.
  useEffect(() => {
    if (!settings.gaze || !settings.camera || !previewStream) return;
    let cancelled = false;
    const monitor = createGazeMonitor({
      stream: previewStream,
      onSignal: (kind, payload) => record(kind, payload as Omit<Signal, "kind" | "at">),
    });
    void monitor.start().then((result) => {
      if (!cancelled && result !== "ok") setGazeNote(true);
    });
    return () => {
      cancelled = true;
      monitor.stop();
    };
  }, [previewStream, record, settings.camera, settings.gaze]);

  // A second display (Window Management API; Chromium reports it without a prompt).
  const displaysChecked = useRef(false);
  useEffect(() => {
    if (!settings.screen || !devicesActive || displaysChecked.current) return;
    displaysChecked.current = true;
    if ((window.screen as Screen & { isExtended?: boolean }).isExtended === true) record("multiple_displays");
  }, [devicesActive, record, settings.screen]);

  const value: ProctoringState = { settings, monitored, active, cameraOn: camera.on, screenOn: screen.on, micOn: mic.on, previewStream, fullscreen };

  const notes = [gazeNote ? GAZE_NOTE : null, settings.fullscreen && !canFullscreen ? FULLSCREEN_NOTE : null].filter((n): n is string => !!n);
  const notesBox =
    notes.length && !notesDismissed ? (
      <div
        role="note"
        className="row g8 card raised small"
        style={{ position: "fixed", left: 16, bottom: 16, zIndex: 40, padding: "8px 10px", maxWidth: 380, alignItems: "flex-start" }}
      >
        <Icon name="info" className="i-sm" />
        <span className="col g4" style={{ flex: 1 }}>
          {notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </span>
        <button type="button" className="btn btn-ghost btn-icon" style={{ width: 24, height: 24 }} onClick={() => setNotesDismissed(true)} aria-label="Dismiss note">
          <Icon name="x" className="i-sm" />
        </button>
      </div>
    ) : null;

  if (!monitored && !settings.fullscreen) return <ProctoringContext.Provider value={value}>{children}</ProctoringContext.Provider>;

  const cameraLost = settings.camera && !camera.on && !!camera.message;
  const screenLost = settings.screen && !screen.on && !!screen.message;
  const micLostNow = settings.microphone && !mic.on && !!mic.message;
  const lostCount = [cameraLost, screenLost, micLostNow].filter(Boolean).length;
  const fullscreenOnly = devicesActive && fullscreenRequired && !fullscreen;
  const heading = fullscreenOnly
    ? enteredFullscreen
      ? "Return to full screen"
      : "Go full screen to start"
    : lostCount === 1 && cameraLost
      ? "We can't see your camera"
      : lostCount === 1 && screenLost
        ? "Screen sharing stopped"
        : lostCount === 1 && micLostNow
          ? "Your microphone is off"
          : "Turn on monitoring to continue";
  const needs = [settings.camera ? "your camera" : null, settings.screen ? "your entire screen" : null, settings.microphone ? "your microphone" : null].filter(
    (n): n is string => !!n,
  );
  const need = needs.length > 1 ? `${needs.slice(0, -1).join(", ")} and ${needs.at(-1)}` : needs[0];
  const intro = fullscreenOnly ? "This simulation runs in full screen." : `This simulation needs ${need}${fullscreenRequired ? ", in full screen" : ""}.`;
  const icon = fullscreenOnly ? "maximize" : screenLost ? "monitor" : "shield";
  const bad = fullscreenOnly || screenLost || micLostNow;

  return (
    <ProctoringContext.Provider value={value}>
      <div data-testid="proctored-content" inert={!active} className="contents">
        {children}
      </div>

      {inlineIndicators || !monitored ? null : (
        <div
          role="status"
          aria-label="Monitoring"
          className="row g8 card raised"
          style={{ position: "fixed", right: 16, bottom: 16, zIndex: 40, padding: 8 }}
        >
          <ProctoringIndicators bare />
          <FullscreenButton />
        </div>
      )}

      {notesBox}

      {active ? null : (
        <div className="wsov">
          <div role="dialog" aria-modal="true" aria-labelledby="monitoring-heading" className="ovbox">
            {cameraLost && lostCount === 1 && !fullscreenOnly ? (
              <div className="campanel" style={{ aspectRatio: "16/8" }}>
                <span className="row g8 small" style={{ color: "#FFB4AC" }}>
                  <Icon name="videoOff" />
                  No camera signal
                </span>
              </div>
            ) : (
              <span className="ovicon" style={bad ? { background: "var(--bad-bg)", color: "var(--bad)" } : { background: "var(--subtle)", color: "var(--ink-2)" }}>
                {micLostNow && lostCount === 1 && !fullscreenOnly ? <Icon name="mic" className="i-lg" /> : <Icon name={icon} className="i-lg" />}
              </span>
            )}
            <div className="col g6">
              <h2 id="monitoring-heading" style={{ fontSize: 22 }}>
                {heading}
              </h2>
              <p className="ink2">
                {intro} Your work is saved. The timer is still running.
              </p>
            </div>
            {[camera.message, screen.message, mic.message].filter(Boolean).map((m) => (
              <p key={m} className="row g8 small" style={{ alignItems: "flex-start", padding: "10px 12px", borderRadius: 8, background: "var(--bad-bg)", color: "var(--bad)" }}>
                <Icon name="alert" />
                <span style={{ color: "var(--ink)" }}>{m}</span>
              </p>
            ))}
            <div className="row g10 wrap">
              {settings.camera && !camera.on ? (
                <button type="button" className="btn btn-dark btn-lg" onClick={() => void startCamera()} disabled={camera.starting}>
                  <Icon name="refresh" />
                  Turn on camera
                </button>
              ) : null}
              {settings.screen && !screen.on ? (
                <button type="button" className="btn btn-dark btn-lg" onClick={() => void startScreen()} disabled={screen.starting}>
                  <Icon name="monitor" />
                  Share entire screen
                </button>
              ) : null}
              {settings.microphone && !mic.on ? (
                <button type="button" className="btn btn-dark btn-lg" onClick={() => void startMicrophone()} disabled={mic.starting}>
                  <Icon name="mic" />
                  Turn on microphone
                </button>
              ) : null}
              {fullscreenRequired && !fullscreen ? (
                // Called straight from the click: browsers only allow full screen from a user gesture.
                <button type="button" className="btn btn-dark btn-lg" onClick={enterFullscreen}>
                  <Icon name="maximize" />
                  Go full screen
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </ProctoringContext.Provider>
  );
}

type ProctoringState = {
  settings: Settings;
  monitored: boolean;
  active: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  micOn: boolean;
  previewStream: MediaStream | null;
  fullscreen: boolean;
};

const ProctoringContext = createContext<ProctoringState | null>(null);

/**
 * Camera thumbnail, screen-share chip and microphone chip for the workspace
 * header (prototype .camthumb / .scr). Renders nothing when the assessment
 * isn't monitored. `bare` drops the status role (the floating card already has it).
 */
export function ProctoringIndicators({ bare = false }: { bare?: boolean }) {
  const p = useContext(ProctoringContext);
  if (!p || !p.monitored) return null;
  const { settings, cameraOn, screenOn, micOn, previewStream } = p;
  const items = (
    <>
      {settings.camera ? (
        <span className={cameraOn ? "camthumb" : "camthumb off"} role="img" aria-label={cameraOn ? "Your camera preview" : "Camera off"} style={{ overflow: "hidden" }}>
          {previewStream && cameraOn ? <CameraPreview stream={previewStream} /> : null}
          <span className="sr">{cameraOn ? "Camera on" : "Camera off"}</span>
        </span>
      ) : null}
      {settings.screen ? (
        <span className={screenOn ? "scr" : "scr off"} role="img" aria-label={screenOn ? "Entire screen shared" : "Screen sharing stopped"}>
          <Icon name="monitor" />
          <span className="sr">{screenOn ? "Screen shared" : "Screen not shared"}</span>
        </span>
      ) : null}
      {settings.microphone ? (
        <span className={micOn ? "scr" : "scr off"} role="img" aria-label={micOn ? "Microphone on" : "Microphone off"}>
          <Icon name="mic" />
          <span className="sr">{micOn ? "Microphone on" : "Microphone off"}</span>
        </span>
      ) : null}
    </>
  );
  if (bare) return items;
  return (
    <span role="status" aria-label="Monitoring" className="row g6">
      {items}
    </span>
  );
}

/**
 * "Go full screen", shown while the screen is shared and the page isn't full
 * screen yet. When full screen is required the cover has this button instead.
 */
export function FullscreenButton() {
  const p = useContext(ProctoringContext);
  if (!p || !p.settings.screen || !p.active || p.fullscreen) return null;
  if (typeof document === "undefined" || !document.fullscreenEnabled) return null;
  return (
    <button type="button" className="btn btn-sm" onClick={enterFullscreen}>
      <Icon name="maximize" />
      Go full screen
    </button>
  );
}

export function CameraPreview({ stream, className, style }: { stream: MediaStream; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video
      ref={ref}
      aria-label="Camera preview"
      autoPlay
      muted
      playsInline
      className={className}
      style={style ?? (className ? undefined : { display: "block", width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 })}
    />;
}
