"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { isMonitored, monitoringNotice, type Proctoring } from "@/lib/proctoring/config";
import { CAMERA_MESSAGES, SCREEN_MESSAGES, canShareScreen, openCamera, openScreen } from "@/lib/proctoring/client/media";
import { holdMedia } from "@/lib/proctoring/client/media-store";
import { CameraPreview } from "@/lib/proctoring/client/proctoring";
import { makeSignal, sendSignals } from "@/lib/proctoring/client/signals";
import { takeSnapshot } from "@/lib/proctoring/client/snapshots";
import { primaryButton, secondaryButton } from "../../ui";

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 600;
const OFF: Proctoring = { camera: false, screen: false };

interface CheckResult {
  desktop: boolean;
  screenOk: boolean;
  width: number;
  height: number;
}

function runChecks(): CheckResult {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  const mobile = uaData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const width = window.screen.width;
  const height = window.screen.height;
  return { desktop: !mobile, screenOk: width >= MIN_WIDTH && height >= MIN_HEIGHT, width, height };
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

type Device = { state: "idle" | "pending" | "pass" | "fail"; detail?: string };
type RowState = "pending" | "pass" | "fail" | "off" | "todo";

const record = (kind: Parameters<typeof makeSignal>[0], payload?: Parameters<typeof makeSignal>[1]) =>
  void sendSignals([makeSignal(kind, payload)]).catch(() => {});

/**
 * Browser, screen size and, when the assessment uses them, the monitoring
 * notice, a camera check (with a start photo) and an entire-screen share.
 * Nothing is requested from the browser before the candidate agrees. The
 * camera and screen streams are kept for the workspace (client navigation).
 */
export function SystemCheck({
  token,
  proctoring = OFF,
  consented = false,
  companyName = "the company",
}: {
  token: string;
  proctoring?: Proctoring;
  consented?: boolean;
  companyName?: string;
}) {
  const result = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const screenSupported = useSyncExternalStore(noSubscribe, canShareScreen, () => true);
  const monitored = isMonitored(proctoring);
  const [agreed, setAgreed] = useState(consented);
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [camera, setCamera] = useState<Device>({ state: "idle" });
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<Device>({ state: "idle" });

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
      setCamera({ state: "fail", detail: CAMERA_MESSAGES[r.reason] });
      return;
    }
    holdMedia("camera", r.stream);
    setCameraStream(r.stream);
    setCamera({ state: "pass", detail: "Camera works." });
    // Start photo (docs/04). Best effort; the workspace keeps taking them.
    void takeSnapshot("camera", r.stream);
  }

  async function shareScreen() {
    setScreen({ state: "pending" });
    const r = await openScreen();
    if (!r.ok) {
      if (r.reason === "wrong_surface") record("screen_share_wrong_surface", { surface: r.surface });
      if (r.reason === "cancelled") record("screen_share_refused");
      setScreen({ state: "fail", detail: SCREEN_MESSAGES[r.reason] });
      return;
    }
    holdMedia("screen", r.stream);
    record("screen_share_started", { surface: r.surface });
    setScreen({ state: "pass", detail: "Entire screen shared. Keep it shared until you submit." });
  }

  const basicsPassed = result ? result.desktop && result.screenOk : false;
  const cameraOk = !proctoring.camera || camera.state === "pass";
  const screenOk = !proctoring.screen || screen.state === "pass";
  const passed = basicsPassed && (!monitored || agreed) && cameraOk && screenOk;

  const unsupported = proctoring.screen && agreed && !screenSupported;
  const cameraRow: RowState = !proctoring.camera ? "off" : camera.state === "idle" ? "todo" : camera.state;
  const screenRow: RowState = !proctoring.screen ? "off" : unsupported ? "fail" : screen.state === "idle" ? "todo" : screen.state;
  const screenDetail = !proctoring.screen
    ? "Not used in this test."
    : unsupported
      ? SCREEN_MESSAGES.unsupported
      : (screen.detail ?? "You'll be asked what to share. Pick “Entire screen”.");

  return (
    <div className="space-y-6">
      {monitored ? (
        <section aria-labelledby="monitoring-heading" className="space-y-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <h2 id="monitoring-heading" className="font-semibold">
            Monitoring for this test
          </h2>
          {monitoringNotice(proctoring, companyName).map((p) => (
            <p key={p} className="leading-6 text-neutral-700 dark:text-neutral-300">
              {p}
            </p>
          ))}
          <label className="flex items-start gap-2 font-medium">
            <input
              type="checkbox"
              className="mt-1"
              checked={agreed || saving}
              disabled={agreed || saving}
              onChange={(e) => {
                if (e.target.checked) void agree();
              }}
            />
            <span>I agree to camera and screen monitoring for this test, as described above.</span>
          </label>
          {consentError ? <p className="text-red-700 dark:text-red-400">{consentError}</p> : null}
          <p className="text-neutral-600 dark:text-neutral-400">No webcam, or need another arrangement? Contact {companyName} before you start.</p>
        </section>
      ) : null}

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        <CheckRow
          label="Desktop or laptop browser"
          state={result === null ? "pending" : result.desktop ? "pass" : "fail"}
          detail={result && !result.desktop ? "This test needs a computer. Please reopen the link on a desktop or laptop." : undefined}
        />
        <CheckRow
          label={`Screen at least ${MIN_WIDTH}×${MIN_HEIGHT}`}
          state={result === null ? "pending" : result.screenOk ? "pass" : "fail"}
          detail={result ? `Your screen: ${result.width}×${result.height}` : undefined}
        />
        <CheckRow
          label="Camera"
          state={cameraRow}
          detail={!proctoring.camera ? "Not used in this test." : (camera.detail ?? "We take a start photo once it works.")}
          media={cameraStream ? <CameraPreview stream={cameraStream} className="h-24 w-32" /> : null}
          action={
            proctoring.camera && camera.state !== "pass" ? (
              <button type="button" className={secondaryButton} disabled={!agreed || camera.state === "pending"} onClick={() => void testCamera()}>
                {camera.state === "fail" ? "Try camera again" : "Test camera"}
              </button>
            ) : null
          }
        />
        <CheckRow
          label="Screen share"
          state={screenRow}
          detail={screenDetail}
          action={
            proctoring.screen && screen.state !== "pass" && !unsupported ? (
              <button type="button" className={secondaryButton} disabled={!agreed || screen.state === "pending"} onClick={() => void shareScreen()}>
                Share entire screen
              </button>
            ) : null
          }
        />
      </ul>

      {passed ? (
        <Link href={`/a/${token}/instructions`} className={primaryButton}>
          Continue to instructions
        </Link>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {result === null ? "Checking…" : monitored && !agreed ? "Read and agree to the monitoring notice to continue." : "Fix the items above to continue."}
        </p>
      )}
    </div>
  );
}

function CheckRow({ label, state, detail, action, media }: { label: string; state: RowState; detail?: string; action?: ReactNode; media?: ReactNode }) {
  const badge = {
    pending: <span className="text-neutral-600 dark:text-neutral-400">Checking…</span>,
    pass: <span className="text-green-700 dark:text-green-400">OK</span>,
    fail: <span className="text-red-700 dark:text-red-400">Problem</span>,
    off: <span className="text-neutral-600 dark:text-neutral-400">Not used</span>,
    todo: <span className="text-neutral-600 dark:text-neutral-400">To do</span>,
  }[state];
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="space-y-2">
        <p className="font-medium">{label}</p>
        {detail ? <p className="text-neutral-600 dark:text-neutral-400">{detail}</p> : null}
        {media}
        {action}
      </div>
      {badge}
    </li>
  );
}
