"use client";

import type { DisplaySurface } from "../config";

/** Opening the camera and the entire-screen share, with plain-language failures. */

export type CameraResult = { ok: true; stream: MediaStream } | { ok: false; reason: "blocked" | "missing" | "failed" | "unsupported" };
export type ScreenResult =
  | { ok: true; stream: MediaStream; surface: DisplaySurface }
  | { ok: false; reason: "cancelled" | "wrong_surface" | "failed" | "unsupported"; surface?: DisplaySurface };

export const CAMERA_MESSAGES: Record<Exclude<CameraResult, { ok: true }>["reason"], string> = {
  blocked: "Camera access was blocked. Allow it in your browser's site settings, then try again.",
  missing: "No camera found. Connect one and try again.",
  failed: "Couldn't start the camera. Close other apps that use it, then try again.",
  unsupported: "This browser can't use a camera. Use a recent Chrome, Edge, Firefox or Safari on a computer.",
};

export const SCREEN_MESSAGES: Record<Exclude<ScreenResult, { ok: true }>["reason"], string> = {
  cancelled: "Screen sharing was cancelled. You need to share your entire screen to take this test.",
  wrong_surface: "You shared a window or tab. Choose “Entire screen” instead.",
  failed: "Couldn't start screen sharing. Try again.",
  unsupported: "This browser can't share your screen. Use a recent Chrome, Edge or Firefox on a computer.",
};

export const canShareScreen = () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

export async function openCamera(): Promise<CameraResult> {
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return { ok: false, reason: "unsupported" };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    return { ok: true, stream };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, reason: "blocked" };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { ok: false, reason: "missing" };
    return { ok: false, reason: "failed" };
  }
}

/**
 * Asks for the entire screen. Browsers that report the shared surface must
 * report "monitor"; a window or tab is stopped straight away. Browsers that
 * don't report it are accepted as "unknown" (recorded with the start event).
 */
export async function openScreen(): Promise<ScreenResult> {
  if (!canShareScreen()) return { ok: false, reason: "unsupported" };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" },
      audio: false,
      // Chromium hints: offer whole screens, hide this tab, no switching mid-share.
      monitorTypeSurfaces: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "failed" };
  }
  const track = stream.getVideoTracks()[0];
  const reported = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  const surface: DisplaySurface =
    reported === "monitor" || reported === "window" || reported === "browser" || reported === "application" ? reported : "unknown";
  if (surface !== "monitor" && surface !== "unknown") {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, reason: "wrong_surface", surface };
  }
  return { ok: true, stream, surface };
}
