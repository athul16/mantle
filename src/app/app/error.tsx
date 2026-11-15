"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * Error boundary for the company app (/app and every /app/<org> page). Never
 * shows the error itself. Server errors carry Next's digest, which matches
 * the server log line; client errors get a made-up id logged with the error.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void; reset: () => void }) {
  const [ref] = useState(() => errorRef(error));
  useEffect(() => {
    console.error(`[app error ${ref}]`, error);
  }, [error, ref]);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "64px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", background: "var(--warn-bg)", color: "var(--warn)" }}>
        <Icon name="alert" className="i-lg" />
      </span>
      <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
      <p className="ink2">Nothing you saved before this was lost. Try again; if it keeps happening, send us this reference:</p>
      <p className="small tnum strong" data-testid="error-ref">
        {ref}
      </p>
      <div>
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          <Icon name="refresh" />
          Try again
        </button>
      </div>
    </main>
  );
}

function errorRef(error: unknown): string {
  const digest = error && typeof error === "object" && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  if (typeof digest === "string" && digest) return digest;
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
