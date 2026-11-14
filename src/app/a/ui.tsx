import type { CSSProperties, ReactNode } from "react";
import { CompanyLogo } from "@/components/brand";
import { Icon, type IconName } from "@/components/icons";

/**
 * Layout pieces shared by the candidate pages, from the product prototype
 * (src/app/mantle.css: .split, .baside, .cand-head, .card ...).
 */

/** The candidate journey shown in the dark sidebar. */
export const JOURNEY = ["Verify and consent", "System check", "Instructions and practice"] as const;

/**
 * Dark brand sidebar (.baside) for the split pages: company, role, time,
 * deadline and the four steps. `step` is 1-based; earlier steps show a check.
 */
export function BrandAside({
  companyName,
  jobTitle,
  minutes,
  deadline,
  step,
  stepNote,
}: {
  companyName: string;
  jobTitle: string;
  minutes: number;
  /** e.g. "start by Fri, Nov 21" (a node so it can hold a LocalTime). */
  deadline?: ReactNode;
  step: 1 | 2 | 3 | 4;
  /** Small line under the current step. */
  stepNote?: string;
}) {
  const items = [...JOURNEY, `The ${minutes}-minute simulation`];
  return (
    <aside className="baside">
      <div className="row g12">
        <CompanyLogo name={companyName} inverse />
        <span className="bname">{companyName}</span>
      </div>
      <div className="col g10">
        <span className="beyebrow">Work simulation</span>
        <p className="bh1 display">{jobTitle}</p>
        <p className="bsub">
          {minutes} minutes{deadline ? <> · {deadline}</> : null}
        </p>
      </div>
      <ol className="bsteps" aria-label="Progress">
        {items.map((label, i) => {
          const n = i + 1;
          const st = n < step ? "done" : n === step ? "on" : "todo";
          return (
            <li key={label} className={`bstep ${st}`} aria-current={st === "on" ? "step" : undefined}>
              <span className="bnum">{st === "done" ? <Icon name="check" className="i-sm" /> : n}</span>
              <span>
                {label}
                {st === "done" ? <span className="sr"> (done)</span> : null}
                {st === "on" && stepNote ? <span className="bnote">{stepNote}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <span className="grow" />
      <p className="bfoot">Questions? Reply to your invitation email from {companyName}. Powered by Mantle.</p>
    </aside>
  );
}

/** Split page: brand sidebar on the left, content on the right (.split / .split-main). */
export function SplitPage({ aside, children, mainStyle }: { aside: ReactNode; children: ReactNode; mainStyle?: CSSProperties }) {
  return (
    <div className="split">
      {aside}
      <main className="split-main" style={mainStyle}>
        {children}
      </main>
    </div>
  );
}

/** White top bar with the company and role (.cand-head), for done and similar pages. */
export function CandHead({ companyName, jobTitle }: { companyName: string; jobTitle?: string }) {
  return (
    <header className="cand-head">
      <CompanyLogo name={companyName} size={32} />
      <div className="col" style={{ lineHeight: 1.25 }}>
        <span className="strong">{companyName}</span>
        {jobTitle ? <span className="xs muted">{jobTitle}</span> : null}
      </div>
    </header>
  );
}

const ROUND_ICON: Record<"neutral" | "ok" | "warn" | "bad", CSSProperties> = {
  neutral: { background: "var(--subtle)", color: "var(--ink-2)" },
  ok: { background: "var(--ok-bg)", color: "var(--ok)" },
  warn: { background: "var(--warn-bg)", color: "var(--warn)" },
  bad: { background: "var(--bad-bg)", color: "var(--bad)" },
};

/**
 * Centred card for link states (resume, expired, withdrawn, not recognised,
 * error): optional company row, optional round icon, title, then children.
 */
export function StateCard({
  title,
  children,
  companyName,
  icon,
  tone = "neutral",
}: {
  title: string;
  children?: ReactNode;
  companyName?: string;
  icon?: IconName;
  tone?: keyof typeof ROUND_ICON;
}) {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px 120px" }}>
      <article className="card raised" style={{ width: "100%", maxWidth: 480, padding: 32, display: "flex", flexDirection: "column", gap: 20 }}>
        {companyName ? (
          <div className="row g10">
            <CompanyLogo name={companyName} size={32} />
            <span className="strong">{companyName}</span>
          </div>
        ) : null}
        {icon ? (
          <span className="ovicon" style={{ width: 44, height: 44, ...ROUND_ICON[tone] }}>
            <Icon name={icon} className="i-lg" />
          </span>
        ) : null}
        <h1 style={{ fontSize: 26 }}>{title}</h1>
        {children}
      </article>
    </main>
  );
}

const MESSAGE_TONES = {
  bad: { bg: "var(--bad-bg)", line: "var(--bad-line)", color: "var(--bad)", icon: "xc" },
  warn: { bg: "var(--warn-bg)", line: "var(--warn-line)", color: "var(--warn)", icon: "clock" },
  info: { bg: "var(--subtle)", line: "var(--line)", color: "var(--ink-2)", icon: "info" },
  ok: { bg: "var(--ok-bg)", line: "var(--ok-line)", color: "var(--ok)", icon: "mail" },
} as const;

/** Message box from the verify page (prototype verifyMsg()): icon in the tone colour, text in ink. */
export function MessageBox({ tone, icon, children }: { tone: keyof typeof MESSAGE_TONES; icon?: IconName; children: ReactNode }) {
  const t = MESSAGE_TONES[tone];
  return (
    <div
      role={tone === "bad" || tone === "warn" ? "alert" : "status"}
      style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 10, background: t.bg, border: `1px solid ${t.line}`, color: t.color }}
    >
      <Icon name={icon ?? t.icon} />
      <span className="small" style={{ color: "var(--ink)" }}>
        {children}
      </span>
    </div>
  );
}

/**
 * Generic centred card, kept for pages that haven't moved to a prototype
 * layout. `wide` widens it.
 */
export function CandidateCard({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "64px 24px 120px" }}>
      <article
        className="card raised"
        style={{ width: "100%", maxWidth: wide ? 720 : 480, padding: 32, display: "flex", flexDirection: "column", gap: 20 }}
      >
        <h1 style={{ fontSize: 26 }}>{title}</h1>
        {children}
      </article>
    </main>
  );
}

/** Old tone names map onto MessageBox tones. */
export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const map = { info: "info", error: "bad", success: "ok" } as const;
  const icon = { info: "info", error: "xc", success: "checkc" } as const;
  return (
    <MessageBox tone={map[tone]} icon={icon[tone]}>
      {children}
    </MessageBox>
  );
}

/** Label/value grid in a card (prototype landing facts). */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="card" style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", overflow: "hidden" }}>
      {items.map(([label, value], i) => (
        <div
          key={label}
          style={{
            padding: "16px 18px",
            // Same borders as the prototype's 2×2 facts card.
            borderBottom: i < items.length - 2 ? "1px solid var(--line)" : undefined,
            borderRight: i % 2 === 0 ? "1px solid var(--line)" : undefined,
          }}
        >
          <dt className="xs muted">{label}</dt>
          <dd className="strong" style={{ margin: "4px 0 0" }}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export const primaryButton = "btn btn-dark btn-lg";
export const secondaryButton = "btn btn-lg";

/** Messages for ?error= codes coming back from the /api/candidate handlers. */
export const ERROR_TEXT: Record<string, string> = {
  invalid: "This link isn't valid. Check that you copied the whole link from your invitation email.",
  revoked: "This invitation was withdrawn by the company.",
  expired: "This invitation has expired.",
  completed: "You've already submitted this assessment.",
  too_soon: "We just sent a code. Wait a few seconds before asking for another.",
  no_code: "That code has already been used or was never sent. Send a new code.",
  code_expired: "That code has expired. Send a new code.",
  wrong_code: "That code isn't right.",
  locked: "Too many wrong codes. Send a new code to try again.",
  busy: "Please try again.",
  bad_input: "Enter your name and the 6-digit code, and tick the box to agree.",
};
