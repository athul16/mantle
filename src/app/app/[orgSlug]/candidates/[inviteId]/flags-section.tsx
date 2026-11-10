import type { ReportFlag } from "@/lib/proctoring/report";
import { FlagReviewForm } from "./flag-review-form";

const muted = "text-neutral-600 dark:text-neutral-400";

const STATUS: Record<ReportFlag["status"], { label: string; className: string }> = {
  open: { label: "Open", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  confirmed: { label: "Confirmed", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
  cleared: { label: "Cleared", className: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
};

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

/**
 * Integrity flags on the candidate report (docs/02): each flag's reason,
 * evidence times and snapshot thumbnails, and the review controls for admins
 * and recruiters. Flags never decide anything on their own.
 */
export function FlagsSection({
  orgId,
  startedAt,
  flags,
  canReview,
  canSeeMedia,
  monitored,
}: {
  orgId: string;
  startedAt: string | null;
  flags: ReportFlag[];
  canReview: boolean;
  canSeeMedia: boolean;
  monitored: boolean;
}) {
  const anyMedia = flags.some((f) => f.media.length > 0);
  return (
    <section className="space-y-3" aria-labelledby="flags-heading">
      <h2 id="flags-heading" className="text-lg font-medium">
        Integrity flags ({flags.length})
      </h2>
      <p className={`text-sm ${muted}`}>
        Flags point to moments worth checking. They don&apos;t reject anyone: look at the evidence, then confirm or clear each one.
      </p>
      {!monitored ? (
        <p className={`text-sm ${muted}`}>Camera and screen monitoring were off for this assessment; only browser activity was checked.</p>
      ) : null}
      {monitored && !canSeeMedia && flags.length ? (
        <p className={`text-sm ${muted}`}>Snapshots are visible to admins and recruiters only.</p>
      ) : null}
      {flags.length === 0 ? <p className={`text-sm ${muted}`}>No integrity flags.</p> : null}

      {flags.map((f) => {
        const status = STATUS[f.status];
        return (
          <article key={f.id} aria-labelledby={`flag-${f.id}`} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`flag-${f.id}`} className="font-medium">
                {f.reason}
              </h3>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
            </header>

            {f.events.length ? (
              <ul aria-label="Evidence" className="space-y-0.5 text-sm">
                {f.events.map((e, n) => (
                  <li key={`${e.at}-${n}`}>{eventLine(e, startedAt)}</li>
                ))}
              </ul>
            ) : null}

            {canSeeMedia && f.media.length ? (
              <ul aria-label="Snapshots" className="flex flex-wrap gap-2">
                {f.media.map((m) => {
                  const offset = offsetFrom(startedAt, m.at);
                  const alt = `${m.source === "camera" ? "Camera" : m.source === "screen" ? "Screen" : "Phone"} snapshot${offset ? ` at ${offset}` : ""}`;
                  return (
                    <li key={m.id}>
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                        {/* Signed, short-lived storage URLs: next/image would cache them past expiry. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.url} alt={alt} width={160} height={100} className="h-24 w-40 rounded border border-neutral-200 object-cover dark:border-neutral-800" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {f.status !== "open" ? (
              <div className="text-sm">
                <p className={muted}>
                  {status.label} by {f.reviewerEmail ?? "a teammate"}
                </p>
                {f.reviewNote ? <p className="mt-1 whitespace-pre-wrap">{f.reviewNote}</p> : null}
              </div>
            ) : null}

            {canReview ? <FlagReviewForm orgId={orgId} flagId={f.id} reason={f.reason} reviewed={f.status !== "open"} /> : null}
          </article>
        );
      })}
      {anyMedia && canSeeMedia ? <p className={`text-xs ${muted}`}>Snapshot links expire after 10 minutes; reload the page for fresh ones.</p> : null}
    </section>
  );
}
