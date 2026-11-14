"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";

/**
 * Start for monitored tests. Starts the timer with fetch and moves on with a
 * client navigation, so the camera and screen streams from the system check
 * stay open and the candidate isn't asked to share again.
 */
export function StartMonitoredButton({ token, minutes }: { token: string; minutes: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
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
      setError("Couldn't start the simulation. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div className="col g8">
      <button type="button" className="btn btn-dark btn-lg" disabled={pending} onClick={() => void start()}>
        {pending ? (
          "Starting…"
        ) : (
          <>
            <Icon name="play" />
            Start the {minutes}-minute simulation
          </>
        )}
      </button>
      {error ? (
        <p className="small badc" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
