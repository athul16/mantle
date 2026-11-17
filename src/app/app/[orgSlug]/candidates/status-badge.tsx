import type { CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { InviteStatus } from "@/lib/jobs/status";
import type { IntegrityLabel } from "@/lib/results/candidate-table";

// Status language from the prototype: colour + icon + label, never colour alone.

const STATUS: Record<InviteStatus, { label: string; icon: IconName; className: string; style?: CSSProperties }> = {
  completed: { label: "Completed", icon: "check", className: "badge" },
  started: { label: "In progress", icon: "clock", className: "badge b-accent" },
  invited: { label: "Invited", icon: "mail", className: "badge b-plain" },
  expired: { label: "Expired", icon: "xc", className: "badge b-plain", style: { color: "var(--ink-3)" } },
  revoked: { label: "Revoked", icon: "ban", className: "badge b-plain", style: { color: "var(--ink-3)", borderStyle: "dashed" } },
};

export function StatusBadge({ status, needsReview = false, replyToScore = false }: { status: InviteStatus; needsReview?: boolean; replyToScore?: boolean }) {
  const s = STATUS[status];
  const badge = (
    <span className={s.className} style={s.style}>
      <Icon name={s.icon} />
      {s.label}
    </span>
  );
  if (!needsReview) return badge;
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      {badge}
      <span className="badge b-accent" title="A task needs scoring. The score is provisional.">
        <Icon name="reply" />
        {replyToScore ? "Reply to score" : "Needs review"}
      </span>
    </span>
  );
}

const INTEGRITY: Record<IntegrityLabel, { label: string; icon: IconName; className: string }> = {
  clear: { label: "Clear", icon: "checkc", className: "badge b-ok" },
  review: { label: "Review", icon: "eye", className: "badge b-warn" },
  suspicious: { label: "Suspicious", icon: "alert", className: "badge b-bad" },
};

/** The attempt's integrity label with its flag count. A label for a person to judge; it never rejects anyone. */
export function IntegrityBadge({ label, flags }: { label: IntegrityLabel; flags: number }) {
  const i = INTEGRITY[label];
  return (
    <span className={i.className}>
      <Icon name={i.icon} />
      {i.label}
      {label !== "clear" && flags > 0 ? ` · ${flags}` : ""}
    </span>
  );
}
