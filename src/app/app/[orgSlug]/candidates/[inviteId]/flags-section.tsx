import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { ReportFlag, ReportFlagMedia } from "@/lib/proctoring/report";
import { formatSeconds, integrityLabel, labelReasons } from "@/lib/proctoring/rules";
import { FlagReviewForm } from "./flag-review-form";
import type { SignalCounts } from "./integrity";
import { CardTitle } from "./report-ui";

const EVENT_TEXT: Record<string, string> = {
  left_window: "Left the test window",
  pasted: "Pasted text",
  copied: "Copied text",
  cut: "Cut text",
  looking_away: "Looked away",
  no_face: "No face in view",
  multiple_faces: "More than one face in view",
  speech_started: "Speech heard",
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

const CLOSED_BY: Record<string, string> = {
  reconnected: "back on",
  submitted: "never back; counted until submit",
  deadline: "never back; counted until the time ran out",
};

/** One camera / screen gap (D4): how long, from when to when, and how it ended. */
function downtimeLine(e: ReportFlag["events"][number], startedAt: string | null): string {
  const what = e.source === "camera" ? "Camera off" : e.source === "fullscreen" ? "Left full screen" : "Screen share stopped";
  const from = offsetFrom(startedAt, e.at);
  const to = e.endAt ? offsetFrom(startedAt, e.endAt) : "";
  const span = from && to ? ` · ${from} to ${to} into the test` : "";
  return `${what} for ${formatSeconds((e.downMs ?? 0) / 1000)} (${CLOSED_BY[e.closedBy ?? "reconnected"]})${span}`;
}

function eventLine(e: ReportFlag["events"][number], startedAt: string | null): string {
  if (e.kind === "monitoring_down") return downtimeLine(e, startedAt);
  const offset = offsetFrom(startedAt, e.at);
  const at = offset ? ` · ${offset} into the test` : "";
  const secs = (ms: number) => formatSeconds(ms / 1000);
  if (e.kind === "looking_away") return `Looked away${e.direction ? ` (${e.direction})` : ""}${e.awayMs ? ` for ${secs(e.awayMs)}` : ""}${at}`;
  if (e.kind === "no_face") return `No face in view${e.awayMs ? ` for ${secs(e.awayMs)}` : ""}${at}`;
  if (e.kind === "multiple_faces") return `${e.faces ?? 2} faces in view${at}`;
  if (e.kind === "speech_started") return `Speech heard${e.speechMs ? ` for ${secs(e.speechMs)}` : ""}${at}`;
  const parts = [EVENT_TEXT[e.kind] ?? e.kind];
  if (e.awayMs) parts.push(`${Math.round(e.awayMs / 1000)} s away`);
  if (e.chars) parts.push(`${e.chars} characters`);
  return `${parts.join(", ")}${at}`;
}

/** copy_then_leave stores [copy, departure] pairs; read each as one line. */
function pairLines(events: ReportFlag["events"], startedAt: string | null): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < events.length; i += 2) {
    const [c, l] = [events[i], events[i + 1]];
    const gap = formatSeconds(Math.max(0, Date.parse(l.at) - Date.parse(c.at)) / 1000);
    const offset = offsetFrom(startedAt, c.at);
    out.push(`${c.kind === "cut" ? "Cut" : "Copied"} ${c.chars ?? 0} characters, then left the window ${gap} later${offset ? ` · ${offset} into the test` : ""}`);
  }
  return out;
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
function signalRows(counts: SignalCounts, camera: boolean, screen: boolean, on: { gaze: boolean; microphone: boolean; fullscreen: boolean }): [string, ReactNode][] {
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
    ["Copies", <Count key="cp" n={c("copied") + c("cut")} />],
    ...(on.fullscreen ? [] : ([["Left full screen", <Count key="f" n={c("fullscreen_exited")} />]] as [string, ReactNode][])),
    ...(on.gaze
      ? ([
          ["Looked away", <Count key="la" n={c("looking_away")} />],
          ["No face", <Count key="nf" n={c("no_face")} />],
          ["More than one face", <Count key="mf" n={c("multiple_faces")} />],
        ] as [string, ReactNode][])
      : []),
    ...(on.microphone ? ([["Speech heard", <Count key="sp" n={c("speech_started")} />]] as [string, ReactNode][]) : []),
    ...(on.fullscreen ? ([["Full screen exits", <Count key="fx" n={c("fullscreen_exited")} />]] as [string, ReactNode][]) : []),
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
  gaze = false,
  microphone = false,
  fullscreen = false,
}: {
  orgId: string;
  startedAt: string | null;
  flags: ReportFlag[];
  counts: SignalCounts;
  canReview: boolean;
  canSeeMedia: boolean;
  camera: boolean;
  screen: boolean;
  /** Which optional monitoring the assessment used (after waivers); each adds its counters. */
  gaze?: boolean;
  microphone?: boolean;
  fullscreen?: boolean;
}) {
  const rows = signalRows(counts, camera, screen, { gaze, microphone, fullscreen });
  const reasons = labelReasons(flags);
  const label = integrityLabel(flags);
  const monitored = camera || screen;
  const anyMedia = flags.some((f) => f.media.length > 0);
  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby="integrity-heading">
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--line)" }}>
        <CardTitle id="integrity-heading">Integrity</CardTitle>
        <span style={{ flex: 1 }} />
        <IntegrityBadge flags={flags} />
      </div>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <span className="strong" data-testid="integrity-label">
          {label === "suspicious" ? "Suspicious" : label === "review" ? "Review" : "Clear"}
        </span>
        {reasons.length ? (
          <ul aria-label="Why this label" className="ink2" style={{ margin: 0, paddingLeft: 18 }}>
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        <span className="xs muted">Suspicious = a combination of signals that together suggest outside help; Review = something unusual a person should look at.</span>
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

/** Screenshots (and camera shots) taken while away from one departure, in time order: "+2 s", "+6 s", "back". */
function Filmstrip({ event }: { event: ReportFlag["events"][number] }) {
  const shots = (event.media ?? []).filter((m) => m.source !== "audio").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const since = (m: ReportFlagMedia) => Math.max(0, Math.round((Date.parse(m.at) - Date.parse(event.at)) / 1000));
  return (
    <ul aria-label="Screenshots while away" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 8, overflowX: "auto" }}>
      {shots.map((m) => {
        const what = m.source === "camera" ? "Camera" : m.source === "phone" ? "Phone" : "Screen";
        const back = m.reason === "returned";
        const alt = back ? `${what} when back` : `${what} ${since(m)} s after leaving`;
        return (
          <li key={m.id} style={{ flex: "0 0 auto", width: 120, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
              {/* Signed, short-lived storage URLs: next/image would cache them past expiry. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={alt} style={{ display: "block", width: 120, height: 75, objectFit: "cover", borderRadius: 6, background: "#DDE1E6" }} />
            </a>
            <span className="xs muted tnum">{back ? "back" : `+${since(m)} s`}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FlagEvidence({ flag, startedAt, canSeeMedia }: { flag: ReportFlag; startedAt: string | null; canSeeMedia: boolean }) {
  const audio = flag.media.filter((m) => m.source === "audio");
  const images = flag.media.filter((m) => m.source !== "audio");
  const lines = flag.rule === "copy_then_leave" ? pairLines(flag.events, startedAt) : flag.events.map((e) => eventLine(e, startedAt));
  return (
    <>
      {flag.rule === "downtime" ? (
        <p className="small ink2">The task was covered during each gap and the timer kept running. Judge whether the lost time affected the result.</p>
      ) : null}
      {canSeeMedia && audio.length ? (
        <ul aria-label="Audio clips" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {audio.map((m) => {
            const offset = offsetFrom(startedAt, m.at);
            const text = `Audio clip (speech heard)${offset ? ` at ${offset}` : ""}`;
            return (
              <li key={m.id} className="xs ink2" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span>{text}</span>
                <audio controls preload="none" src={m.url} aria-label={text} style={{ width: "100%" }} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {canSeeMedia ? flag.events.map((e, n) => (e.media?.some((m) => m.source !== "audio") ? <Filmstrip key={`${e.at}-${n}`} event={e} /> : null)) : null}
      {canSeeMedia && images.length ? (
        <ul aria-label="Snapshots" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: images.length > 1 ? "1fr 1fr" : "1fr", gap: 8 }}>
          {images.map((m) => {
            const offset = offsetFrom(startedAt, m.at);
            const alt = `${m.source === "camera" ? "Camera" : m.source === "screen" ? "Screen" : "Phone"} snapshot${offset ? ` at ${offset}` : ""}`;
            return (
              <li key={m.id}>
                <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                  {/* Signed, short-lived storage URLs: next/image would cache them past expiry. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={alt} style={{ display: "block", width: "100%", height: images.length > 1 ? 90 : 150, objectFit: "cover", borderRadius: 6, background: "#DDE1E6" }} />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {lines.length ? (
        <ul aria-label="Evidence" className="xs ink2" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {lines.map((line, n) => (
            <li key={n}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
