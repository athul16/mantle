"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { verifySignIn } from "../actions";

export function VerifyForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifySignIn, undefined);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      {state?.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}
