"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import {
  MAX_MEDIA_RETENTION_DAYS,
  MAX_RESULTS_RETENTION_DAYS,
  MIN_MEDIA_RETENTION_DAYS,
  MIN_RESULTS_RETENTION_DAYS,
} from "@/lib/retention/policy";
import { updateRetention } from "./actions";

export function RetentionForm({ orgId, mediaDays, resultsDays }: { orgId: string; mediaDays: number; resultsDays: number }) {
  const [state, action, pending] = useActionState(updateRetention, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Field
            label="Keep photos and screenshots for (days)"
            name="mediaRetentionDays"
            inputMode="numeric"
            defaultValue={String(mediaDays)}
            required
            aria-describedby="media-retention-help"
            error={state?.fieldErrors?.mediaRetentionDays?.[0]}
          />
          <p id="media-retention-help" className="text-xs text-neutral-600 dark:text-neutral-400">
            {MIN_MEDIA_RETENTION_DAYS} to {MAX_MEDIA_RETENTION_DAYS} days, and no longer than results.
          </p>
        </div>
        <div className="space-y-1">
          <Field
            label="Keep results for (days)"
            name="resultsRetentionDays"
            inputMode="numeric"
            defaultValue={String(resultsDays)}
            required
            aria-describedby="results-retention-help"
            error={state?.fieldErrors?.resultsRetentionDays?.[0]}
          />
          <p id="results-retention-help" className="text-xs text-neutral-600 dark:text-neutral-400">
            {MIN_RESULTS_RETENTION_DAYS} to {MAX_RESULTS_RETENTION_DAYS} days.
          </p>
        </div>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      <FormMessage error={state?.error} message={state?.message} />
    </form>
  );
}
