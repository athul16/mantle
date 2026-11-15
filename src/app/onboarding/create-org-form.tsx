"use client";

import { useActionState, useState } from "react";
import { CompanyLogo } from "@/components/brand";
import { Icon } from "@/components/icons";
import { Button, Field, FormMessage } from "@/components/ui";
import { createOrganization } from "./actions";

export function CreateOrgForm() {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  const [name, setName] = useState("");
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Field
        label="Company name"
        name="name"
        autoComplete="organization"
        required
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        error={state?.fieldErrors?.name?.[0]}
      />
      <div>
        <span className="label">
          Logo <span className="soon" style={{ marginLeft: 6 }}>Soon</span>
        </span>
        <div className="row g16">
          <CompanyLogo name={name.trim() || "?"} size={64} />
          <p className="small ink2" style={{ flex: 1 }}>
            Until logo upload is ready, candidates see your initials on this tile.
          </p>
        </div>
      </div>
      <FormMessage error={state?.error} />
      <div className="divider" />
      <div className="row g10">
        <span style={{ flex: 1 }} />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create company"}
          {pending ? null : <Icon name="arrowR" />}
        </Button>
      </div>
    </form>
  );
}
