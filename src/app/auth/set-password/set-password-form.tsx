"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { setPassword } from "./actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} error={state?.fieldErrors?.password?.[0]} />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required error={state?.fieldErrors?.confirm?.[0]} />
      <FormMessage error={state?.error} />
      <Button type="submit" size="lg" disabled={pending} style={{ width: "100%" }}>
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}
