"use client";

import { useFormStatus } from "react-dom";
import { removeFactor } from "../actions";

export function RemoveFactorButton({ factorId, name, last, isAdmin }: { factorId: string; name: string; last: boolean; isAdmin: boolean }) {
  const warning =
    last && isAdmin
      ? `Remove ${name}? This turns two-factor off, and you'll need to set it up again before you can use your company.`
      : `Remove ${name}? It will no longer work for signing in.`;
  return (
    <form
      action={removeFactor}
      onSubmit={(e) => {
        if (!window.confirm(warning)) e.preventDefault();
      }}
    >
      <input type="hidden" name="factorId" value={factorId} />
      <SubmitButton name={name} />
    </form>
  );
}

function SubmitButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-label={`Remove ${name}`} className="btn btn-sm btn-danger">
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
