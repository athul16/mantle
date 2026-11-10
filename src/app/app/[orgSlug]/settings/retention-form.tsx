"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "@/lib/retention/policy";
import { updateRetention } from "./actions";

export function RetentionForm({ orgId, days }: { orgId: string; days: number }) {
  const [state, action, pending] = useActionState(updateRetention, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <Field
            label="Keep candidate data for (days)"
            name="retentionDays"
            inputMode="numeric"
            defaultValue={String(days)}
            required
            aria-describedby="retention-help"
            error={state?.fieldErrors?.retentionDays?.[0]}
          />
        </div>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      <p id="retention-help" className="text-xs text-neutral-600 dark:text-neutral-400">
        {MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS} days.
      </p>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}
