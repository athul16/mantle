import type { ReactNode } from "react";

/** Small layout pieces shared by the candidate pages. */

export function CandidateCard({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16">
      <div className={`w-full space-y-6 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200",
    error: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    success: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300",
  }[tone];
  return <p className={`rounded-md px-3 py-2 text-sm ${styles}`}>{children}</p>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-neutral-500">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const primaryButton =
  "inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200";
export const secondaryButton =
  "inline-block rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900";

/** Messages for ?error= codes coming back from the /api/candidate handlers. */
export const ERROR_TEXT: Record<string, string> = {
  invalid: "This link isn't valid. Check you copied the whole link from your email.",
  revoked: "This invitation was withdrawn by the company.",
  expired: "This invitation has expired.",
  completed: "You've already submitted this assessment.",
  too_soon: "We just sent a code. Wait a few seconds before asking for another.",
  no_code: "That code has already been used or was never sent. Ask for a new code.",
  code_expired: "That code has expired. Ask for a new code.",
  wrong_code: "That code isn't right.",
  locked: "Too many wrong codes. Ask for a new code.",
  busy: "Please try again.",
  bad_input: "Enter your name and the 6-digit code, and tick the consent box.",
};
