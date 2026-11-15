"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { StateCard } from "../ui";

/**
 * Error boundary for every candidate page under /a/<token> (prototype link
 * state "Something went wrong"). Never shows the error itself. Server errors
 * carry Next's digest, which matches the server log line; client errors get a
 * made-up id that is logged with the error.
 */
export default function CandidateError({ error, retry }: { error: unknown; retry: () => void; reset: () => void }) {
  const [ref] = useState(() => errorRef(error));
  useEffect(() => {
    console.error(`[candidate error ${ref}]`, error);
  }, [error, ref]);

  return (
    <StateCard title="Something went wrong" icon="alert" tone="warn">
      <p className="ink2" style={{ marginTop: -14 }}>
        Your progress is saved — answers are stored as you go. If your test has started, its clock keeps running, so try again as soon as you
        can.
      </p>
      <p className="small ink2">
        If it keeps happening, open the link from your invitation email again, or reply to that email to contact the company that invited you.
        Quote the reference so they can find what happened.
      </p>
      <div className="row g14 wrap">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          <Icon name="refresh" />
          Try again
        </button>
        <span className="xs muted tnum">
          Reference <span data-testid="error-ref">{ref}</span>
        </span>
      </div>
    </StateCard>
  );
}

function errorRef(error: unknown): string {
  const digest = error && typeof error === "object" && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  if (typeof digest === "string" && digest) return digest;
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
