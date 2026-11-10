"use client";

import { useEffect, useState } from "react";

/**
 * Last-resort boundary when the root layout itself fails. Renders its own
 * document (no global CSS is loaded here, so styles are inline). Never shows
 * the error; the digest matches the server log line.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void; reset: () => void }) {
  const [ref] = useState(() => errorRef(error));
  useEffect(() => {
    console.error(`[global error ${ref}]`, error);
  }, [error, ref]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1.5rem", color: "#171717", background: "#fff" }}>
        <title>Something went wrong</title>
        <main style={{ maxWidth: "28rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>
            Please try again. If you were taking an assessment, your progress is saved. If it keeps happening, quote this
            reference when you get in touch:
          </p>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.875rem" }} data-testid="error-ref">
            {ref}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ padding: "0.5rem 1rem", borderRadius: "0.375rem", border: 0, background: "#171717", color: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

function errorRef(error: unknown): string {
  const digest = error && typeof error === "object" && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  if (typeof digest === "string" && digest) return digest;
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
