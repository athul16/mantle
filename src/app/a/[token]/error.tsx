"use client";

import { useEffect, useState } from "react";
import { CandidateCard, Notice, primaryButton } from "../ui";

/**
 * Error boundary for every candidate page under /a/<token>. Never shows the
 * error itself. Server errors carry Next's digest, which matches the server
 * log line; client errors get a made-up id that is logged with the error.
 */
export default function CandidateError({ error, retry }: { error: unknown; retry: () => void; reset: () => void }) {
  const [ref] = useState(() => errorRef(error));
  useEffect(() => {
    console.error(`[candidate error ${ref}]`, error);
  }, [error, ref]);

  return (
    <CandidateCard title="Something went wrong">
      <Notice>Your progress is saved: answers are stored as you go. If your test has started, its timer keeps running, so retry as soon as you can.</Notice>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Try again in a moment. If it keeps happening, open the link from your invitation email again, or reply to that
        email to contact the company that invited you. Quote this reference so they can find what happened:
      </p>
      <p className="font-mono text-sm" data-testid="error-ref">
        {ref}
      </p>
      <button type="button" className={primaryButton} onClick={() => retry()}>
        Try again
      </button>
    </CandidateCard>
  );
}

function errorRef(error: unknown): string {
  const digest = error && typeof error === "object" && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  if (typeof digest === "string" && digest) return digest;
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
