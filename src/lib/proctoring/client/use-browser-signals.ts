"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ClientSignalKind } from "../config";
import { makeSignal, sendSignals, type Signal } from "./signals";

export type { Signal };

/** Signals are sent in batches this often (and right away when the page closes). */
export const SIGNAL_FLUSH_MS = 5_000;

/**
 * Browser signals during the attempt (docs/02): leaving the test window (tab
 * switch or another app), entering and leaving full screen, copy, cut and
 * paste. Clipboard text is never read beyond its length. Returns `record` for other signals (screen
 * share stopped, ...) so they go out in the same batches.
 */
export function useBrowserSignals({ onSignal }: { onSignal?: (s: Signal) => void } = {}) {
  const queue = useRef<Signal[]>([]);
  const onSignalRef = useRef(onSignal);
  useEffect(() => {
    onSignalRef.current = onSignal;
  });

  const record = useCallback((kind: ClientSignalKind, payload: Omit<Signal, "kind" | "at"> = {}) => {
    const signal = makeSignal(kind, payload);
    queue.current.push(signal);
    onSignalRef.current?.(signal);
  }, []);

  const flush = useCallback(async (keepalive = false) => {
    if (!queue.current.length) return;
    const batch = queue.current.splice(0);
    try {
      await sendSignals(batch, { keepalive });
    } catch {
      // Offline for a moment: keep them for the next batch.
      queue.current.unshift(...batch);
    }
  }, []);

  useEffect(() => {
    let awaySince: number | null = null;
    let wasFullscreen = !!document.fullscreenElement;

    const leave = () => {
      if (awaySince !== null) return;
      awaySince = Date.now();
      record("left_window");
    };
    const back = () => {
      if (awaySince === null || document.hidden) return;
      const awayMs = Date.now() - awaySince;
      awaySince = null;
      record("returned_to_window", { awayMs });
    };
    const onVisibility = () => {
      if (document.hidden) leave();
      else if (document.hasFocus()) back();
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        wasFullscreen = true;
        record("fullscreen_entered");
      } else if (wasFullscreen) {
        wasFullscreen = false;
        record("fullscreen_exited");
      }
    };
    const onPaste = (e: Event) => {
      const text = (e as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
      record("pasted", { chars: text.length });
    };
    const selectedChars = (e: Event) => {
      const t = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      const inField = t && typeof t.selectionStart === "number" && typeof t.selectionEnd === "number";
      return inField ? Math.abs((t.selectionEnd ?? 0) - (t.selectionStart ?? 0)) : (window.getSelection()?.toString().length ?? 0);
    };
    const onCopy = (e: Event) => record("copied", { chars: selectedChars(e) });
    const onCut = (e: Event) => record("cut", { chars: selectedChars(e) });
    const onPageHide = () => void flush(true);

    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCut, true);
    window.addEventListener("pagehide", onPageHide);
    const timer = setInterval(() => void flush(), SIGNAL_FLUSH_MS);

    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCut, true);
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(timer);
      void flush(true);
    };
  }, [flush, record]);

  return { record };
}
