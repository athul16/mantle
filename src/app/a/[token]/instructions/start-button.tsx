"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { enterFullscreen } from "@/lib/candidate/fullscreen";

/**
 * Starts the test. Goes full screen from the click, starts the timer with
 * fetch and moves on with a client navigation, so full screen and any camera
 * and screen streams from the system check stay open.
 */
export function StartButton({ token, minutes, fullscreen = true }: { token: string; minutes: number; fullscreen?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (fullscreen) enterFullscreen();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/candidate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.status === 401) return router.replace(`/a/${token}`);
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) return router.replace(`/a/${token}/workspace`);
      return router.replace(body.error === "expired" ? `/a/${token}` : `/a/${token}/done`);
    } catch {
      setError("Couldn't start. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    // A real form, so Start still works (as a plain POST) before the page hydrates.
    <form
      action="/api/candidate/start"
      method="post"
      className="col g8"
      style={{ alignItems: "flex-end" }}
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
        {pending ? (
          "Starting…"
        ) : (
          <>
            Start the {minutes}-minute test
            <Icon name="arrowR" />
          </>
        )}
      </button>
      {error ? (
        <p className="small badc" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** "Back to your test" for a test that has already started: back to the workspace, in full screen. */
export function ResumeLink({ token, fullscreen = true }: { token: string; fullscreen?: boolean }) {
  return (
    <Link href={`/a/${token}/workspace`} className="btn btn-primary btn-lg" onClick={fullscreen ? enterFullscreen : undefined}>
      Back to your test
      <Icon name="arrowR" />
    </Link>
  );
}
