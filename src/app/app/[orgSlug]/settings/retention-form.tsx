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

/** Two retention clocks (D2): photos and screenshots, then results. Admins only. */
export function RetentionForm({ orgId, mediaDays, resultsDays }: { orgId: string; mediaDays: number; resultsDays: number }) {
  const [state, action, pending] = useActionState(updateRetention, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
        <Field
          label="Keep photos and screenshots for (days)"
          name="mediaRetentionDays"
          className="tnum"
          inputMode="numeric"
          defaultValue={String(mediaDays)}
          required
          help={`${MIN_MEDIA_RETENTION_DAYS} to ${MAX_MEDIA_RETENTION_DAYS} days, and no longer than results.`}
          error={state?.fieldErrors?.mediaRetentionDays?.[0]}
        />
        <Field
          label="Keep results for (days)"
          name="resultsRetentionDays"
          className="tnum"
          inputMode="numeric"
          defaultValue={String(resultsDays)}
          required
          help={`${MIN_RESULTS_RETENTION_DAYS} to ${MAX_RESULTS_RETENTION_DAYS} days.`}
          error={state?.fieldErrors?.resultsRetentionDays?.[0]}
        />
      </div>
      <FormMessage error={state?.error} message={state?.message} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
