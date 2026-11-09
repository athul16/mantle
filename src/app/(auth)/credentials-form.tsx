"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, FormMessage, type FormState } from "@/components/ui";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function CredentialsForm({ action, submitLabel, passwordAutoComplete }: { action: Action; submitLabel: string; passwordAutoComplete: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const next = useSearchParams().get("next") ?? "";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required error={state?.fieldErrors?.email?.[0]} />
      <Field label="Password" name="password" type="password" autoComplete={passwordAutoComplete} required minLength={8} error={state?.fieldErrors?.password?.[0]} />
      <FormMessage error={state?.error} message={state?.message} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
