"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { updateContactEmail } from "./actions";

/** The address candidates are told to ask for accommodations (D9). Admins only. */
export function ContactEmailForm({ orgId, email }: { orgId: string; email: string | null }) {
  const [state, action, pending] = useActionState(updateContactEmail, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <div style={{ maxWidth: 360 }}>
        <Field
          label="Contact email for candidates"
          name="contactEmail"
          type="email"
          autoComplete="email"
          defaultValue={email ?? ""}
          help="Leave blank to remove it. Use a shared inbox your recruiters watch, for example careers@yourfirm.com."
          error={state?.fieldErrors?.contactEmail?.[0]}
        />
      </div>
      <FormMessage error={state?.error} message={state?.message} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Set contact email"}
        </Button>
      </div>
    </form>
  );
}
