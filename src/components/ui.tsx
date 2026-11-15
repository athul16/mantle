import { useId, type ComponentProps, type ReactNode } from "react";
import { MantleMark } from "./brand";
import { Icon } from "./icons";

// Shared form pieces built on the prototype's classes (src/app/mantle.css):
// .label, .input, .help, .btn and its variants, .card.

export function Field({
  label,
  name,
  error,
  help,
  ...input
}: { label: string; name: string; error?: string; help?: ReactNode } & ComponentProps<"input">) {
  // The error and help sit outside the <label> so they aren't part of the input's
  // accessible name; aria-describedby links them instead.
  const id = useId();
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [input["aria-describedby"], help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="label" htmlFor={input.id ?? id}>
        {label}
      </label>
      <input
        id={input.id ?? id}
        name={name}
        {...input}
        className={`input${error ? " invalid" : ""}${input.className ? ` ${input.className}` : ""}`}
        aria-invalid={error ? true : input["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {help ? (
        <p id={helpId} className="help">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="co-err">
          <Icon name="alert" className="i-sm" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "dark" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/** Class string for a .btn, for links styled as buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  const v = { primary: "btn-primary", secondary: "", danger: "btn-danger", dark: "btn-dark", ghost: "btn-ghost" }[variant];
  const s = { sm: "btn-sm", md: "", lg: "btn-lg" }[size];
  return ["btn", v, s, extra].filter(Boolean).join(" ");
}

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

/** A coloured notice: red for errors, green for success. */
export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (message) return <Notice tone="ok">{message}</Notice>;
  return null;
}

const NOTICE_TONES = {
  info: { bg: "var(--subtle)", line: "var(--line)", color: "var(--ink-2)", icon: "info" },
  accent: { bg: "var(--accent-soft)", line: "var(--accent-line)", color: "var(--accent-ink)", icon: "info" },
  ok: { bg: "var(--ok-bg)", line: "var(--ok-line)", color: "var(--ok)", icon: "checkc" },
  warn: { bg: "var(--warn-bg)", line: "var(--warn-line)", color: "var(--warn)", icon: "alert" },
  bad: { bg: "var(--bad-bg)", line: "var(--bad-line)", color: "var(--bad)", icon: "xc" },
} as const;

/** A full-width message box with an icon, in one of the status colours. */
export function Notice({ tone = "info", children, icon }: { tone?: keyof typeof NOTICE_TONES; children: ReactNode; icon?: ComponentProps<typeof Icon>["name"] }) {
  const t = NOTICE_TONES[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className="row g10 small"
      style={{ alignItems: "flex-start", padding: "12px 14px", borderRadius: 8, background: t.bg, border: `1px solid ${t.line}`, color: t.color }}
    >
      <Icon name={icon ?? t.icon} />
      <div style={{ color: "var(--ink)" }}>{children}</div>
    </div>
  );
}

/**
 * Centred auth layout from the prototype (.co-center): the large Mantle mark
 * above a raised card. `above` sits between the mark and the card (a stepper),
 * `below` under it.
 */
export function AuthCard({
  title,
  children,
  footer,
  intro,
  width = 420,
  above,
  below,
  icon,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  intro?: ReactNode;
  width?: number;
  above?: ReactNode;
  below?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <main className="co-center">
      <MantleMark large />
      <div style={{ width: "100%", maxWidth: width, display: "flex", flexDirection: "column", gap: 16 }}>
        {above}
        <div className="card raised" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
          {icon}
          <h1 style={{ fontSize: 24 }}>{title}</h1>
          {intro ? <p className="small ink2">{intro}</p> : null}
          {children}
          {footer ? <div className="small ink2">{footer}</div> : null}
        </div>
        {below}
      </div>
    </main>
  );
}

/** Result shape every form server action returns to useActionState. */
export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;
