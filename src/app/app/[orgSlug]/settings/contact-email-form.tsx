"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { updateContactEmail } from "./actions";

export function ContactEmailForm({ orgId, email }: { orgId: string; email: string | null }) {
  const [state, action, pending] = useActionState(updateContactEmail, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-80">
          <Field
            label="Contact email for candidates"
            name="contactEmail"
            type="email"
            autoComplete="email"
            defaultValue={email ?? ""}
            aria-describedby="contact-email-help"
            error={state?.fieldErrors?.contactEmail?.[0]}
          />
        </div>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Set contact email"}</Button>
      </div>
      <p id="contact-email-help" className="text-xs text-neutral-600 dark:text-neutral-400">
        Leave blank to remove it. Use a shared inbox your recruiters watch, for example careers@yourfirm.com.
      </p>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}
