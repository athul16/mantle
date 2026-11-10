import { useId, type ComponentProps, type ReactNode } from "react";

// Minimal shared form pieces. Plain Tailwind, no design system yet.

export function Field({ label, name, error, ...input }: { label: string; name: string; error?: string } & ComponentProps<"input">) {
  // The error sits outside the <label> so it isn't part of the input's
  // accessible name; aria-describedby links it instead.
  const errorId = `${useId()}-error`;
  const describedBy = [input["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{label}</span>
        <input
          name={name}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
          {...input}
          aria-invalid={error ? true : input["aria-invalid"]}
          aria-describedby={describedBy}
        />
      </label>
      {error ? (
        <span id={errorId} className="text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Button({ className = "", variant = "primary", ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
    secondary: "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900",
    danger: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950",
  }[variant];
  return (
    <button
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>;
  if (message) return <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">{message}</p>;
  return null;
}

export function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
        {footer ? <div className="text-sm text-neutral-600 dark:text-neutral-400">{footer}</div> : null}
      </div>
    </main>
  );
}

/** Result shape every form server action returns to useActionState. */
export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;
