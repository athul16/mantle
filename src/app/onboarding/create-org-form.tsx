"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { createOrganization } from "./actions";

export function CreateOrgForm() {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Company name" name="name" autoComplete="organization" required error={state?.fieldErrors?.name?.[0]} />
      <FormMessage error={state?.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create company"}
      </Button>
    </form>
  );
}
