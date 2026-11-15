import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { LocalDate } from "../local-date";

/** Breadcrumb, heading and the lock notice above the Configure assessment form. */
export function ConfigureShell({
  libraryHref,
  simulation,
  lockedAt,
  readOnly,
  children,
}: {
  libraryHref: string;
  simulation: string;
  lockedAt: string | null;
  readOnly: boolean;
  children: ReactNode;
}) {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 32px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <Link href={libraryHref}>Assessments</Link>
        <Icon name="chevR" className="i-sm muted" />
        <span className="muted">{simulation}</span>
      </nav>
      <div>
        <h1 style={{ fontSize: 26 }}>Configure assessment</h1>
        <p className="ink2" style={{ marginTop: 4 }}>Based on the {simulation} simulation.</p>
      </div>
      {lockedAt ? (
        <div
          role="status"
          style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 8, background: "var(--warn-bg)", border: "1px solid var(--warn-line)", color: "var(--warn)" }}
        >
          <Icon name="lock" />
          <span className="small">
            Locked since <LocalDate iso={lockedAt} withTime /> because a candidate started. Clone it to change settings.
          </span>
        </div>
      ) : readOnly ? (
        <div className="co-banner">
          <Icon name="lock" />
          <span className="small">You&apos;re a viewer, so you can see these settings but not change them.</span>
        </div>
      ) : (
        <div
          style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 8, background: "var(--accent-soft)", border: "1px solid var(--accent-line)", color: "var(--accent-ink)" }}
        >
          <Icon name="lock" />
          <span className="small">
            These settings lock once the first candidate starts, so every candidate is judged the same way. To change them later, clone the assessment.
          </span>
        </div>
      )}
      {children}
    </main>
  );
}
