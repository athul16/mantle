"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icons";
import { Button, FormMessage } from "@/components/ui";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "@/lib/retention/policy";
import { updateRetention } from "./actions";

export function RetentionForm({ orgId, days }: { orgId: string; days: number }) {
  const [state, action, pending] = useActionState(updateRetention, undefined);
  const error = state?.fieldErrors?.retentionDays?.[0];
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label htmlFor="ret-days" className="small">Keep candidate data for</label>
        <input
          id="ret-days"
          name="retentionDays"
          className={error ? "input tnum invalid" : "input tnum"}
          style={{ width: 90 }}
          inputMode="numeric"
          defaultValue={String(days)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "ret-help ret-error" : "ret-help"}
        />
        <span id="ret-help" className="small muted">
          days after the assessment ends ({MIN_RETENTION_DAYS}–{MAX_RETENTION_DAYS})
        </span>
      </div>
      {error ? (
        <p id="ret-error" className="co-err" style={{ marginTop: 0 }}>
          <Icon name="alert" className="i-sm" />
          {error}
        </p>
      ) : null}
      <p className="small ink2">
        Covers answers, scores, notes, integrity events and proctoring snapshots. Candidates see this period in the monitoring notice before they agree. You
        can also delete one candidate&apos;s data from their report at any time.
      </p>
      <FormMessage error={state?.error} message={state?.message} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
