"use client";

import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "../submit-button";

/** "I understand…" checkbox, then the final submit (a plain form post to the submit route). */
export function ReviewSubmit({ token }: { token: string }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form action="/api/candidate/submit" method="post" className="col g14">
      <input type="hidden" name="token" value={token} />
      <label className="row g10" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          className="chk"
          required
          // Uncontrolled, so a tick made before hydration isn't wiped; the ref picks it up.
          ref={(el) => {
            if (el?.checked && !confirmed) setConfirmed(true);
          }}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="small">I understand I can&apos;t make changes after submitting.</span>
      </label>
      <div className="row g10 wrap">
        <SubmitButton className="btn btn-dark btn-lg" pendingText="Submitting…" disabled={!confirmed}>
          Submit final answers
        </SubmitButton>
        <Link href={`/a/${token}/workspace`} className="btn btn-lg">
          Keep working
        </Link>
      </div>
    </form>
  );
}
