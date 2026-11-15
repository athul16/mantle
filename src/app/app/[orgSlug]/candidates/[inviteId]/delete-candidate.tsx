"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { FormMessage } from "@/components/ui";
import { deleteCandidate } from "./delete-candidate-action";

const CONFIRM = "delete";

/**
 * "Delete candidate data" card. Everyone sees what it does; only admins get a
 * working button, which opens a dialog with a typed confirmation (the action
 * checks the role again).
 */
export function DeleteCandidateData({
  role,
  orgId,
  orgSlug,
  inviteId,
  jobId,
  candidate,
}: {
  role: string;
  orgId: string;
  orgSlug: string;
  inviteId: string;
  jobId: string;
  candidate: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteCandidate, undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function close() {
    setOpen(false);
    setTyped("");
  }

  return (
    <section
      aria-labelledby="delete-heading"
      className="card"
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, borderColor: "var(--bad-line)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 id="delete-heading" style={{ fontSize: 15, fontFamily: "var(--font)", fontWeight: 700, letterSpacing: 0, margin: 0 }}>
          Delete candidate data
        </h2>
        <span style={{ flex: 1 }} />
        <span className="badge">Admins only</span>
      </div>
      <p className="small ink2">
        Permanently deletes this candidate&apos;s invite, answers, scores, notes, integrity flags and snapshots — for example when they ask you to.
        You&apos;ll type “{CONFIRM}” to confirm.
      </p>
      {isAdmin ? (
        <button type="button" className="btn btn-sm btn-danger" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
          <Icon name="trash" />
          Delete candidate data
        </button>
      ) : (
        <>
          <button type="button" className="btn btn-sm btn-danger" style={{ alignSelf: "flex-start" }} disabled title="Only admins can delete candidate data">
            <Icon name="trash" />
            Delete candidate data
          </button>
          <span className="xs muted">You&apos;re {role === "viewer" ? "a viewer" : "a recruiter"}. Ask an admin.</span>
        </>
      )}

      {isAdmin && open ? (
        <div className="mwrap" onMouseDown={(e) => e.target === e.currentTarget && !pending && close()}>
          <div className="mbox" role="dialog" aria-modal="true" aria-labelledby="del-t">
            <form action={action} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="inviteId" value={inviteId} />
              <input type="hidden" name="jobId" value={jobId} />
              <h2 id="del-t" style={{ fontSize: 20 }}>
                Delete {candidate}&apos;s data?
              </h2>
              <p className="small ink2">
                This permanently deletes their invite, answers, scores, notes, integrity flags and snapshots. It can&apos;t be undone. The deletion
                itself is kept in the audit log.
              </p>
              <div>
                <label className="label" htmlFor="del-confirm">
                  Type “{CONFIRM}” to confirm
                </label>
                <input
                  ref={inputRef}
                  id="del-confirm"
                  name="confirm"
                  className="input"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              <FormMessage error={state?.error} />
              <div className="row g10" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={close} disabled={pending}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  style={{ borderColor: "var(--bad)" }}
                  disabled={pending || typed.trim().toLowerCase() !== CONFIRM}
                >
                  <Icon name="trash" />
                  {pending ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
