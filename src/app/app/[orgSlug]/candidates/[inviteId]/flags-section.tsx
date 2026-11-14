import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { ReportFlag } from "@/lib/proctoring/report";
import { FlagReviewForm } from "./flag-review-form";
import type { SignalCounts } from "./integrity";
import { CardTitle } from "./report-ui";

const EVENT_TEXT: Record<string, string> = {
  left_window: "Left the test window",
  pasted: "Pasted text",
  fullscreen_exited: "Left full screen",
  screen_share_stopped: "Screen sharing stopped",
  screen_share_wrong_surface: "Shared a window or tab, not the entire screen",
  camera_stopped: "Camera turned off",
  multiple_displays: "Second display connected",
};

/** Time since the attempt started, as m:ss or h:mm:ss. */
export function offsetFrom(startedAt: string | null, at: string): string {
  if (!startedAt) return "";
  const total = Math.max(0, Math.round((Date.parse(at) - Date.parse(startedAt)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function eventLine(e: ReportFlag["events"][number], startedAt: string | null): string {
  const parts = [EVENT_TEXT[e.kind] ?? e.kind];
  if (e.awayMs) parts.push(`${Math.round(e.awayMs / 1000)} s away`);
  if (e.chars) parts.push(`${e.chars} characters`);
  const offset = offsetFrom(startedAt, e.at);
  return `${parts.join(", ")}${offset ? ` · ${offset} into the test` : ""}`;
}

/** The integrity badge used on the card header (and the summary). */
export function IntegrityBadge({ flags }: { flags: Pick<ReportFlag, "status">[] }) {
  const open = flags.filter((f) => f.status === "open").length;
  if (!flags.length)
    return (
      <span className="badge b-ok" data-testid="integrity-badge">
        <Icon name="checkc" />
        Clear
      </span>
    );
  if (open)
    return (
      <span className="badge b-warn" data-testid="integrity-badge">
        <Icon name="eye" />
        Review · {open} flag{open > 1 ? "s" : ""}
      </span>
    );
  return (
    <span className="badge" data-testid="integrity-badge">
      <Icon name="check" />
      Reviewed
    </span>
  );
}

type Tone = "ok" | "warn" | "plain";
function Val({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={tone === "ok" ? "badge b-ok" : tone === "warn" ? "badge b-warn" : "badge"}>{children}</span>;
}
function Count({ n }: { n: number }) {
  return (
    <span className="tnum strong" style={n ? { color: "var(--warn)" } : undefined}>
      {n}
    </span>
  );
}

/** What was recorded, one line per signal (prototype's integrity rows), from integrity_events. */
function signalRows(counts: SignalCounts, camera: boolean, screen: boolean): [string, ReactNode][] {
  const c = (k: string) => counts[k] ?? 0;
  const camStops = c("camera_stopped") + c("camera_refused");
  const screenStops = c("screen_share_stopped") + c("screen_share_refused") + c("screen_share_wrong_surface");
  return [
    [
      "Camera on throughout",
      !camera ? <Val tone="plain">Not required</Val> : camStops ? <Val tone="warn">Stopped {camStops}×</Val> : <Val tone="ok">Yes</Val>,
    ],
    [
      "Entire screen shared",
      !screen ? <Val tone="plain">Not required</Val> : screenStops ? <Val tone="warn">Stopped {screenStops}×</Val> : <Val tone="ok">Yes</Val>,
    ],
    ["Left the simulation tab", <Count key="l" n={c("left_window")} />],
    ["Pastes", <Count key="p" n={c("pasted")} />],
    ["Left full screen", <Count key="f" n={c("fullscreen_exited")} />],
    ["Second display connected", c("multiple_displays") ? <Val tone="warn">Yes</Val> : <Val tone="ok">No</Val>],
  ];
}

/**
 * The Integrity card on the candidate report (docs/02): what was recorded,
 * each flag's reason, evidence and snapshots, and the review controls for
 * admins and recruiters. Flags never decide anything on their own.
 */
export function FlagsSection({
  orgId,
  startedAt,
  flags,
  counts,
  canReview,
  canSeeMedia,
  camera,
  screen,
}: {
  orgId: string;
  startedAt: string | null;
  flags: ReportFlag[];
  counts: SignalCounts;
  canReview: boolean;
  canSeeMedia: boolean;
  camera: boolean;
  screen: boolean;
}) {
  const rows = signalRows(counts, camera, screen);
  const monitored = camera || screen;
  const anyMedia = flags.some((f) => f.media.length > 0);
  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby="integrity-heading">
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--line)" }}>
        <CardTitle id="integrity-heading">Integrity</CardTitle>
        <span style={{ flex: 1 }} />
        <IntegrityBadge flags={flags} />
      </div>
      <dl style={{ margin: 0, padding: "6px 18px", fontSize: 13 }}>
        {rows.map(([label, value], i) => (
          <div
            key={label}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : undefined }}
          >
            <dt className="ink2">{label}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>

      {flags.map((f) =>
        f.status === "open" ? (
          <article
            key={f.id}
            aria-labelledby={`flag-${f.id}`}
            style={{ padding: "14px 18px", background: "var(--warn-bg)", borderTop: "1px solid var(--warn-line)", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <FlagHead flag={f} startedAt={startedAt} />
            <FlagEvidence flag={f} startedAt={startedAt} canSeeMedia={canSeeMedia} />
            {canReview ? <FlagReviewForm orgId={orgId} flagId={f.id} reason={f.reason} reviewed={false} /> : null}
          </article>
        ) : (
          <article
            key={f.id}
            aria-labelledby={`flag-${f.id}`}
            style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}
          >
            <span className="row g8">
              <span className={f.status === "cleared" ? "badge b-ok" : "badge b-warn"}>{f.status === "cleared" ? "Cleared" : "Confirmed"}</span>
              <span id={`flag-${f.id}`} className="strong">
                {f.reason}
              </span>
              <FlagTime flag={f} startedAt={startedAt} />
            </span>
            <span className="ink2">
              {f.reviewerEmail ?? "A teammate"}
              {f.reviewNote ? <>: “<span className="pre">{f.reviewNote}</span>”</> : null}
            </span>
            <FlagEvidence flag={f} startedAt={startedAt} canSeeMedia={canSeeMedia} />
            {canReview ? (
              <details>
                <summary className="xs" style={{ cursor: "pointer", color: "var(--accent)" }}>
                  Change decision
                </summary>
                <div style={{ marginTop: 8 }}>
                  <FlagReviewForm orgId={orgId} flagId={f.id} reason={f.reason} reviewed />
                </div>
              </details>
            ) : null}
          </article>
        ),
      )}

      <div style={{ padding: "10px 18px 14px", fontSize: 12, color: "var(--ink-3)", display: "flex", flexDirection: "column", gap: 6, borderTop: flags.length ? "1px solid var(--line)" : undefined }}>
        <span style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <Icon name="info" className="i-sm" />
          <span>
            Flags are for a person to judge. Nothing here rejects anyone.
            {monitored ? " Snapshots are visible to admins and recruiters only." : " Camera and screen monitoring were off for this assessment; only browser activity was checked."}
          </span>
        </span>
        {flags.length === 0 ? <span>No integrity flags.</span> : null}
        {anyMedia && canSeeMedia ? <span>Snapshot links expire after 10 minutes; reload the page for fresh ones.</span> : null}
      </div>
    </section>
  );
}

function FlagTime({ flag, startedAt }: { flag: ReportFlag; startedAt: string | null }) {
  const first = flag.events[0]?.at ?? flag.media[0]?.at;
  const offset = first ? offsetFrom(startedAt, first) : "";
  return offset ? (
    <span className="xs muted tnum" style={{ marginLeft: "auto" }}>
      at {offset}
    </span>
  ) : null;
}

function FlagHead({ flag, startedAt }: { flag: ReportFlag; startedAt: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--warn)", display: "inline-flex" }}>
        <Icon name="flag" />
      </span>
      <h3 id={`flag-${flag.id}`} className="strong small" style={{ margin: 0 }}>
        {flag.reason}
      </h3>
      <FlagTime flag={flag} startedAt={startedAt} />
    </div>
  );
}

function FlagEvidence({ flag, startedAt, canSeeMedia }: { flag: ReportFlag; startedAt: string | null; canSeeMedia: boolean }) {
  return (
    <>
      {canSeeMedia && flag.media.length ? (
        <ul aria-label="Snapshots" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: flag.media.length > 1 ? "1fr 1fr" : "1fr", gap: 8 }}>
          {flag.media.map((m) => {
            const offset = offsetFrom(startedAt, m.at);
            const alt = `${m.source === "camera" ? "Camera" : m.source === "screen" ? "Screen" : "Phone"} snapshot${offset ? ` at ${offset}` : ""}`;
            return (
              <li key={m.id}>
                <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                  {/* Signed, short-lived storage URLs: next/image would cache them past expiry. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={alt} style={{ display: "block", width: "100%", height: flag.media.length > 1 ? 90 : 150, objectFit: "cover", borderRadius: 6, background: "#DDE1E6" }} />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {flag.events.length ? (
        <ul aria-label="Evidence" className="xs ink2" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {flag.events.map((e, n) => (
            <li key={`${e.at}-${n}`}>{eventLine(e, startedAt)}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
