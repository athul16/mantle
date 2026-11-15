import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/** Card heading on the report. An h2 for the outline, drawn like the prototype's Inter h3. */
export function CardTitle({ id, children, size = 15 }: { id?: string; children: ReactNode; size?: number }) {
  return (
    <h2 id={id} style={{ fontSize: size, fontFamily: "var(--font)", fontWeight: 700, letterSpacing: 0, margin: 0 }}>
      {children}
    </h2>
  );
}

/** "6/8" in green when full, amber when partial, red when zero. */
export function PointsBadge({ points, max }: { points: number; max: number }) {
  const cls = points >= max ? "badge b-ok" : points > 0 ? "badge b-warn" : "badge b-bad";
  return (
    <span className={`${cls} tnum`}>
      {fmtPts(points)}/{fmtPts(max)}
    </span>
  );
}

/** Correct / Partial / Wrong / Missing for one scored item. */
export function ResultBadge({ earned, max, answered }: { earned: number; max: number; answered: boolean }) {
  if (earned >= max)
    return (
      <span className="badge b-ok">
        <Icon name="check" />
        Correct
      </span>
    );
  if (earned > 0)
    return (
      <span className="badge b-warn tnum">
        <Icon name="alert" />
        Partial · {fmtPts(earned)}/{fmtPts(max)}
      </span>
    );
  return (
    <span className="badge b-bad">
      <Icon name="x" />
      {answered ? "Wrong" : "Missing"}
    </span>
  );
}

export function fmtPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "1st", "2nd", "23rd". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
