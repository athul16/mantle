"use client";

import { useEffect, useState } from "react";

/**
 * Last-resort boundary when the root layout itself fails. Renders its own
 * document (no global CSS is loaded here, so styles are inline, using the design tokens' values). Never shows
 * the error; the digest matches the server log line.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void; reset: () => void }) {
  const [ref] = useState(() => errorRef(error));
  useEffect(() => {
    console.error(`[global error ${ref}]`, error);
  }, [error, ref]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", fontSize: 14, lineHeight: 1.45, margin: 0, padding: "4rem 1.5rem", color: "#15181C", background: "#F5F6F7" }}>
        <title>Something went wrong</title>
        <main style={{ maxWidth: "28rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.015em", margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ color: "#434B55", margin: "0 0 12px" }}>
            Please try again. If you were taking an assessment, your progress is saved. If it keeps happening, quote this
            reference when you get in touch:
          </p>
          <p style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", margin: "0 0 16px" }} data-testid="error-ref">
            {ref}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ height: 36, padding: "0 14px", borderRadius: 7, border: "1px solid #1B45CA", background: "#1B45CA", color: "#fff", font: "500 14px/1 Inter, system-ui, sans-serif", cursor: "pointer" }}
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
