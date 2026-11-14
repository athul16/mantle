"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { SNAPSHOT_INTERVAL_MS, isMonitored, type Proctoring as Settings, type SnapshotSource } from "../config";
import { CAMERA_MESSAGES, SCREEN_MESSAGES, openCamera, openScreen } from "./media";
import { dropMedia, heldMedia, holdMedia } from "./media-store";
import { takeSnapshot } from "./snapshots";
import { useBrowserSignals, type Signal } from "./use-browser-signals";

/**
 * Monitoring around the workspace (docs/02, docs/04):
 * - browser signals always (leaving the window, full screen, copy/paste);
 * - with camera and/or screen on, the workspace stays covered until each is
 *   running, snapshots go up every SNAPSHOT_INTERVAL_MS and whenever the
 *   candidate leaves the window, and losing either brings the cover back.
 *
 * The cover blocks the page; the server timer keeps running (open decision:
 * pausing the clock while sharing is down).
 */

type DeviceState = { on: boolean; message?: string; starting?: boolean };

const STOPPED = {
  camera: "Your camera turned off. Turn it back on to continue. The timer keeps running.",
  screen: "Screen sharing stopped. Share your entire screen again to continue. The timer keeps running.",
};

/**
 * `inlineIndicators`: the page shows <ProctoringIndicators /> itself (the
 * workspace header does); otherwise a small floating status card is shown.
 */
export function Proctoring({ settings, children, inlineIndicators = false }: { settings: Settings; children: ReactNode; inlineIndicators?: boolean }) {
  const monitored = isMonitored(settings);
  const streams = useRef<Partial<Record<SnapshotSource, MediaStream>>>({});
  const [camera, setCamera] = useState<DeviceState>(() => ({ on: !!(settings.camera && heldMedia("camera")) }));
  const [screen, setScreen] = useState<DeviceState>(() => ({ on: !!(settings.screen && heldMedia("screen")) }));
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(() => (settings.camera ? (heldMedia("camera") ?? null) : null));
  const [fullscreen, setFullscreen] = useState(false);

  const snapshot = useCallback(() => {
    for (const source of ["camera", "screen"] as const) {
      const s = streams.current[source];
      if (s && s.getVideoTracks().some((t) => t.readyState === "live")) void takeSnapshot(source, s);
    }
  }, []);

  const onSignal = useCallback(
    (s: Signal) => {
      if (s.kind === "left_window") snapshot();
    },
    [snapshot],
  );
  const { record } = useBrowserSignals({ onSignal });

  // Wires a stream in: keep it, watch for it ending.
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

  // On mount: reuse streams from the system check, or start the camera (no click needed once allowed).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (settings.camera) {
      const held = heldMedia("camera");
      if (held) attach("camera", held);
      // Next tick, and cancelled on unmount, so a double-mounted effect asks once.
      else timer = setTimeout(() => void startCamera(), 0);
    }
    if (settings.screen) {
      const held = heldMedia("screen");
      if (held) attach("screen", held);
    }
    return () => clearTimeout(timer);
    // Run once per mount; settings don't change during an attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = (!settings.camera || camera.on) && (!settings.screen || screen.on);

  // Snapshots while monitoring is running: one now, then on the interval.
  useEffect(() => {
    if (!monitored || !active) return;
    snapshot();
    const timer = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, monitored, snapshot]);

  // A second display (Window Management API; Chromium reports it without a prompt).
  const displaysChecked = useRef(false);
  useEffect(() => {
    if (!settings.screen || !active || displaysChecked.current) return;
    displaysChecked.current = true;
    if ((window.screen as Screen & { isExtended?: boolean }).isExtended === true) record("multiple_displays");
  }, [active, record, settings.screen]);

  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const value: ProctoringState = { settings, monitored, active, cameraOn: camera.on, screenOn: screen.on, previewStream, fullscreen };

  if (!monitored) return <ProctoringContext.Provider value={value}>{children}</ProctoringContext.Provider>;

  const cameraLost = settings.camera && !camera.on && !!camera.message;
  const screenLost = settings.screen && !screen.on && !!screen.message;
  const heading = cameraLost && !screenLost
    ? "We can't see your camera"
    : screenLost && !cameraLost
      ? "Screen sharing stopped"
      : "Turn on monitoring to continue";
  const need = settings.camera && settings.screen ? "your camera and your entire screen" : settings.camera ? "your camera" : "your entire screen";

  return (
    <ProctoringContext.Provider value={value}>
      <div data-testid="proctored-content" inert={!active} className="contents">
        {children}
      </div>

      {inlineIndicators ? null : (
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

      {active ? null : (
        <div className="wsov">
          <div role="dialog" aria-modal="true" aria-labelledby="monitoring-heading" className="ovbox">
            {cameraLost && !screenLost ? (
              <div className="campanel" style={{ aspectRatio: "16/8" }}>
                <span className="row g8 small" style={{ color: "#FFB4AC" }}>
                  <Icon name="videoOff" />
                  No camera signal
                </span>
              </div>
            ) : (
              <span className="ovicon" style={screenLost ? { background: "var(--bad-bg)", color: "var(--bad)" } : { background: "var(--subtle)", color: "var(--ink-2)" }}>
                <Icon name={screenLost ? "monitor" : "shield"} className="i-lg" />
              </span>
            )}
            <div className="col g6">
              <h2 id="monitoring-heading" style={{ fontSize: 22 }}>
                {heading}
              </h2>
              <p className="ink2">
                This simulation needs {need}. Your work is saved. The timer is running on our server while this message is open.
              </p>
            </div>
            {[camera.message, screen.message].filter(Boolean).map((m) => (
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
            </div>
            <p className="xs muted">
              Monitoring confirms the work is your own. Each time it stops is noted in your activity log.
            </p>
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
  previewStream: MediaStream | null;
  fullscreen: boolean;
};

const ProctoringContext = createContext<ProctoringState | null>(null);

/**
 * Camera thumbnail and screen-share chip for the workspace header (prototype
 * .camthumb / .scr). Renders nothing when the assessment isn't monitored.
 * `bare` drops the status role (the floating card already has it).
 */
export function ProctoringIndicators({ bare = false }: { bare?: boolean }) {
  const p = useContext(ProctoringContext);
  if (!p || !p.monitored) return null;
  const { settings, cameraOn, screenOn, previewStream } = p;
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
    </>
  );
  if (bare) return items;
  return (
    <span role="status" aria-label="Monitoring" className="row g6">
      {items}
    </span>
  );
}

/** "Go full screen", shown while the screen is shared and the page isn't full screen yet. */
export function FullscreenButton() {
  const p = useContext(ProctoringContext);
  if (!p || !p.settings.screen || !p.active || p.fullscreen) return null;
  if (typeof document === "undefined" || !document.fullscreenEnabled) return null;
  return (
    <button type="button" className="btn btn-sm" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>
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
