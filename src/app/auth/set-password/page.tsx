"use client";

import { useActionState } from "react";
import { AuthCard, Button, Field, FormMessage } from "@/components/ui";
import { setPassword } from "./actions";

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, undefined);
  return (
    <AuthCard title="Set your password">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">You were invited to a company account. Choose a password to finish.</p>
      <form action={action} className="space-y-4">
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} error={state?.fieldErrors?.password?.[0]} />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required error={state?.fieldErrors?.confirm?.[0]} />
        <FormMessage error={state?.error} />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </form>
    </AuthCard>
  );
}
