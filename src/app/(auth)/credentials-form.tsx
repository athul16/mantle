"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, FormMessage, type FormState } from "@/components/ui";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function CredentialsForm({
  action,
  submitLabel,
  passwordAutoComplete,
  emailPlaceholder,
}: {
  action: Action;
  submitLabel: string;
  passwordAutoComplete: string;
  emailPlaceholder?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const next = useSearchParams().get("next") ?? "";

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <input type="hidden" name="next" value={next} />
      <Field label="Work email" name="email" type="email" autoComplete="email" placeholder={emailPlaceholder} required error={state?.fieldErrors?.email?.[0]} />
      <Field label="Password" name="password" type="password" autoComplete={passwordAutoComplete} required minLength={8} error={state?.fieldErrors?.password?.[0]} />
      <FormMessage error={state?.error} message={state?.message} />
      <Button type="submit" size="lg" disabled={pending} style={{ width: "100%" }}>
        {pending ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
