import { useEffect } from "react";

/**
 * Puts the candidate pages in full screen. Browsers only allow this from a
 * user gesture, so call it straight from a click handler. Full screen lasts
 * across client navigations (Link / router), so the check page's Continue,
 * the practice page and the workspace all stay in it. A full page load
 * (form POST, reload) drops it.
 */
export function enterFullscreen(): void {
  if (!fullscreenSupported() || document.fullscreenElement) return;
  void document.documentElement.requestFullscreen().catch(() => {});
}

/** Whether this browser can put the page in full screen. */
export function fullscreenSupported(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === "function";
}

/**
 * Back to full screen on the next click when the page isn't in it (after a
 * reload, or after the candidate pressed Esc). It listens for `click`, not
 * pointerdown, so the layout only changes after the click has landed where
 * the candidate aimed. Clicks inside the monitoring overlay (`.wsov`) are
 * skipped: its buttons open the camera or screen picker, which needs the same
 * user gesture full screen would use up.
 */
export function useFullscreenOnInteract(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      if (document.fullscreenElement) return;
      if (e.target instanceof Element && e.target.closest(".wsov")) return;
      enterFullscreen();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [enabled]);
}
