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
    <button
      type="submit"
      disabled={pending}
      aria-label={`Remove ${name}`}
      className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
