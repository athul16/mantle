"use client";

import { useEffect, useState } from "react";

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
    <main className="mx-auto w-full max-w-md space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Nothing you saved before this was lost. Try again; if it keeps happening, send us this reference:
      </p>
      <p className="font-mono text-sm" data-testid="error-ref">
        {ref}
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Try again
      </button>
    </main>
  );
}

function errorRef(error: unknown): string {
  const digest = error && typeof error === "object" && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  if (typeof digest === "string" && digest) return digest;
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
