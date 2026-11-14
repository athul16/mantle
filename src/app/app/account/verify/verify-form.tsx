"use client";

import { useActionState } from "react";
import { Button, Notice } from "@/components/ui";
import { verifySignIn } from "../actions";

export function VerifyForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifySignIn, undefined);
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="mfa-code">Code</label>
        <input
          id="mfa-code"
          name="code"
          className="input tnum"
          style={{ width: 160, letterSpacing: ".3em", fontWeight: 600 }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
        />
      </div>
      {state?.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}
