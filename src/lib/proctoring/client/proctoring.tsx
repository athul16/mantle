"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

const button =
  "inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200";

export function Proctoring({ settings, children }: { settings: Settings; children: ReactNode }) {
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

  if (!monitored) return <>{children}</>;

  return (
    <>
      <div data-testid="proctored-content" inert={!active} className="contents">
        {children}
      </div>

      <div
        role="status"
        aria-label="Monitoring"
        className="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-lg border border-neutral-200 bg-white/95 p-2 text-xs shadow-sm dark:border-neutral-800 dark:bg-neutral-950/95"
      >
        {settings.camera ? (
          <>
            {previewStream ? <CameraPreview stream={previewStream} /> : null}
            <Chip on={camera.on} on-text="Camera on" off-text="Camera off" />
          </>
        ) : null}
        {settings.screen ? <Chip on={screen.on} on-text="Screen shared" off-text="Screen not shared" /> : null}
        {settings.screen && active && !fullscreen && typeof document !== "undefined" && document.fullscreenEnabled ? (
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Go full screen
          </button>
        ) : null}
      </div>

      {active ? null : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="monitoring-heading"
            className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
          >
            <h2 id="monitoring-heading" className="text-lg font-semibold">
              Turn on monitoring to continue
            </h2>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              This test needs {settings.camera && settings.screen ? "your camera and your entire screen" : settings.camera ? "your camera" : "your entire screen"}.
              The timer is running on our server while this message is open.
            </p>
            {[camera.message, screen.message].filter(Boolean).map((m) => (
              <p key={m} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                {m}
              </p>
            ))}
            <div className="flex flex-wrap gap-3">
              {settings.camera && !camera.on ? (
                <button type="button" className={button} onClick={() => void startCamera()} disabled={camera.starting}>
                  Turn on camera
                </button>
              ) : null}
              {settings.screen && !screen.on ? (
                <button type="button" className={button} onClick={() => void startScreen()} disabled={screen.starting}>
                  Share entire screen
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Chip({ on, "on-text": onText, "off-text": offText }: { on: boolean; "on-text": string; "off-text": string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${on ? "bg-green-600" : "bg-red-600"}`} />
      <span className={on ? "text-neutral-700 dark:text-neutral-300" : "font-medium text-red-700 dark:text-red-400"}>{on ? onText : offText}</span>
    </span>
  );
}

export function CameraPreview({ stream, className = "h-12 w-16" }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} aria-label="Camera preview" autoPlay muted playsInline className={`rounded bg-neutral-200 object-cover dark:bg-neutral-800 ${className}`} />;
}
