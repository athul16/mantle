"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar } from "@/components/brand";
import { Icon } from "@/components/icons";
import {
  INTEGRITY_FILTER_LABELS,
  INTEGRITY_FILTERS,
  SCORE_FILTERS,
  filterExtra,
  formatScore,
  ordinal,
  scoreFilterLabel,
  type CandidateRow,
  type IntegrityFilter,
  type ScoreFilter,
} from "@/lib/results/candidate-table";
import { canResend, canRevoke } from "@/lib/jobs/status";
import {
  STATUS_FILTER_LABELS,
  STATUS_FILTERS,
  candidateLabel,
  defaultDir,
  filterRows,
  formatDuration,
  sortRows,
  type SortDir,
  type SortKey,
  type StatusFilter,
} from "@/lib/results/summary";
import { describeAccommodations, hasAccommodations } from "@/lib/accommodations";
import { AccommodationsForm, InviteRowActions } from "../jobs/[jobId]/invite-forms";
import { Ago, ShortDate } from "./dates";
import { ExportDialog } from "./export-dialog";
import { IntegrityBadge, StatusBadge } from "./status-badge";

const SORTABLE: { key: SortKey; label: string }[] = [
  { key: "candidate", label: "Candidate" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score" },
];

export type TableContext = {
  orgId: string;
  /** Recruiters and admins can resend and revoke invites. */
  canManage: boolean;
  /** No new links once the job's invite deadline has passed. */
  deadlinePassed: boolean;
  passScore: number | null;
  jobTitle: string;
  /** The assessment's time limit and monitoring, for the accommodations controls (D9). */
  timeLimitMinutes?: number;
  camera: boolean;
  screen: boolean;
};

/**
 * The job's candidates (screen 6, prototype "Candidates · list"): search and
 * filters, sortable columns, row selection for export, and an invite drawer
 * for candidates who haven't finished.
 */
export function ResultsTable({
  rows,
  reportBase,
  ctx,
  heading,
  actions,
}: {
  rows: CandidateRow[];
  reportBase: string;
  ctx?: TableContext;
  /** Left side of the page header (title and meta line); the Export button sits to its right. */
  heading?: ReactNode;
  /** Buttons after Export, e.g. "Invite candidates". */
  actions?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "score", dir: "desc" });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [score, setScore] = useState<ScoreFilter>("any");
  const [integrity, setIntegrity] = useState<IntegrityFilter>("any");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const passScore = ctx?.passScore ?? null;
  const visible = useMemo(
    () => sortRows(filterExtra(filterRows(rows, status, query) as CandidateRow[], score, integrity, passScore), sort.key, sort.dir) as CandidateRow[],
    [rows, status, query, score, integrity, passScore, sort],
  );
  const filtered = status !== "all" || score !== "any" || integrity !== "any" || query.trim() !== "";
  const drawerRow = drawer ? rows.find((r) => r.inviteId === drawer) ?? null : null;
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.inviteId));

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) }));
  }
  function toggleRow(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.inviteId)));
  }

  const select = (label: string, value: string, onChange: (v: string) => void, options: [string, string][]) => (
    <select className="select" style={{ width: "auto" }} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        {heading}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => setExporting(true)}>
          <Icon name="download" />
          Export
        </button>
        {actions}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 240 }}>
            <span className="muted" style={{ position: "absolute", left: 10, top: 10, display: "flex" }}>
              <Icon name="search" />
            </span>
            <input
              type="search"
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Search candidates"
              aria-label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {select("Score", score, (v) => setScore(v as ScoreFilter), SCORE_FILTERS.filter((f) => f !== "pass" || passScore !== null).map((f) => [f, scoreFilterLabel(f, passScore)]))}
          {select("Status", status, (v) => setStatus(v as StatusFilter), STATUS_FILTERS.map((f) => [f, f === "all" ? "Status: Any" : `Status: ${STATUS_FILTER_LABELS[f]}`]))}
          {select("Integrity", integrity, (v) => setIntegrity(v as IntegrityFilter), INTEGRITY_FILTERS.map((f) => [f, INTEGRITY_FILTER_LABELS[f]]))}
        </div>

        {selected.size > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "var(--ink)", color: "#fff", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
            <span style={{ width: 1, height: 18, background: "rgba(255,255,255,.25)" }} />
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.35)" }}
              onClick={() => setExporting(true)}
            >
              <Icon name="download" />
              Export
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-ghost" style={{ color: "#fff" }} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" className="chk" aria-label="Select all" checked={allVisibleSelected} onChange={toggleAll} />
                </th>
                {SORTABLE.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, color: active ? "var(--ink)" : undefined }}
                      >
                        {c.label}
                        {active ? <Icon name="arrowDown" className="i-sm" /> : null}
                      </button>
                    </th>
                  );
                })}
                <th scope="col">Percentile</th>
                <th scope="col">Tasks</th>
                <th scope="col">Integrity</th>
                <th scope="col">Team</th>
                {ctx?.canManage ? (
                  <th scope="col" className="r">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={ctx?.canManage ? 9 : 8} className="muted" style={{ textAlign: "center", padding: "28px 12px" }}>
                    No candidates match.
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <Row
                    key={r.inviteId}
                    r={r}
                    reportBase={reportBase}
                    ctx={ctx}
                    selected={selected.has(r.inviteId)}
                    onToggle={() => toggleRow(r.inviteId)}
                    onOpen={() => setDrawer(r.inviteId)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", fontSize: 13, color: "var(--ink-3)" }} aria-live="polite">
          <span>
            Showing {visible.length} of {rows.length}
            {filtered ? " (filtered)" : ""}
          </span>
        </div>
      </div>

      {drawerRow ? <InviteDrawer row={drawerRow} ctx={ctx} onClose={() => setDrawer(null)} /> : null}
      {exporting ? (
        <ExportDialog
          jobTitle={ctx?.jobTitle ?? "candidates"}
          selected={rows.filter((r) => selected.has(r.inviteId))}
          matching={visible}
          everyone={rows}
          filtered={filtered}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </>
  );
}

function Row({
  r,
  reportBase,
  ctx,
  selected,
  onToggle,
  onOpen,
}: {
  r: CandidateRow;
  reportBase: string;
  ctx?: TableContext;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const name = candidateLabel(r);
  const hasAttempt = r.status === "completed" || r.status === "started";
  const dash = <span className="muted">—</span>;
  // Kept mounted for revoked rows too, so "Revoked …" stays visible after the action (it renders nothing otherwise).
  const manageable = ctx?.canManage && !hasAttempt;

  let sub: ReactNode;
  if (r.status === "completed")
    sub = r.submittedAt ? (
      <>
        Completed <ShortDate iso={r.submittedAt} />
        {r.timeTakenSeconds !== null ? ` · ${formatDuration(r.timeTakenSeconds)}` : ""}
      </>
    ) : (
      "Completed"
    );
  else if (r.status === "started") sub = r.startedAt ? <>Started <Ago iso={r.startedAt} /></> : "Started";
  else if (r.status === "expired") sub = <>Invite expired <ShortDate iso={r.expiresAt} /></>;
  else if (r.status === "revoked") sub = <>Invited <ShortDate iso={r.invitedAt} /> · revoked</>;
  else sub = <>Invited <ShortDate iso={r.invitedAt} /></>;
  const resent = r.status === "invited" && r.sentCount > 1 && r.lastSentAt ? (
    <>
      {" "}
      · last sent <ShortDate iso={r.lastSentAt} /> ({r.sentCount} sends)
    </>
  ) : null;

  return (
    <tr className={selected ? "sel" : undefined}>
      <td>
        <input type="checkbox" className="chk" aria-label={`Select ${name}`} checked={selected} onChange={onToggle} />
      </td>
      <td>
        {hasAttempt ? (
          <Link href={`${reportBase}/${r.inviteId}`} style={{ fontWeight: 600, color: "var(--ink)" }}>
            {name}
          </Link>
        ) : (
          <button type="button" className="linkbtn" onClick={onOpen} style={{ fontWeight: 600, color: r.status === "revoked" ? "var(--ink-2)" : "var(--ink)" }}>
            {name}
          </button>
        )}
        <div className="xs muted">
          {sub}
          {resent}
        </div>
        {hasAccommodations(r.accommodations) ? (
          <div className="xs" style={{ color: "var(--accent-ink)" }} data-testid="invite-accommodations">
            Accommodations: {describeAccommodations(r.accommodations, ctx?.timeLimitMinutes).join(", ")}
          </div>
        ) : null}
      </td>
      <td>
        <StatusBadge status={r.status} needsReview={r.needsReview} replyToScore={r.replyToScore} />
      </td>
      {r.percent === null ? (
        <td>{dash}</td>
      ) : (
        <td className="tnum" title={`${r.points} / ${r.maxPoints} points${r.needsReview ? " so far" : ""}`}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{formatScore(r.percent)}</span>
        </td>
      )}
      <td className="tnum">{r.percentile === null ? dash : ordinal(r.percentile)}</td>
      <td>
        {r.tasks.length ? (
          <span style={{ display: "flex", gap: 4 }}>
            {r.tasks.map((t) => (
              <span
                key={t.stepId}
                className="meter"
                style={{ width: 26 }}
                role="img"
                aria-label={`${t.title}: ${t.points} of ${t.maxPoints}`}
                title={`${t.title}: ${t.points} / ${t.maxPoints}`}
              >
                <span style={{ width: `${t.maxPoints > 0 ? Math.round((100 * t.points) / t.maxPoints) : 0}%` }} />
              </span>
            ))}
          </span>
        ) : (
          dash
        )}
      </td>
      <td>{r.integrity ? <IntegrityBadge label={r.integrity} flags={r.flagCount} /> : dash}</td>
      <td>
        {r.hireVotes || r.noHireVotes ? (
          <span className="small ink2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {r.hireVotes ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={`${r.hireVotes} hire vote${r.hireVotes === 1 ? "" : "s"}`}>
                <Icon name="up" className="i-sm" />
                {r.hireVotes}
              </span>
            ) : null}
            {r.noHireVotes ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={`${r.noHireVotes} no-hire vote${r.noHireVotes === 1 ? "" : "s"}`}>
                <Icon name="down" className="i-sm" />
                {r.noHireVotes}
              </span>
            ) : null}
          </span>
        ) : (
          dash
        )}
      </td>
      {ctx?.canManage ? (
        <td className="r" style={{ whiteSpace: "nowrap" }}>
          {manageable ? (
            <InviteRowActions
              orgId={ctx.orgId}
              inviteId={r.inviteId}
              email={r.email}
              canResend={canResend(r.status) && !ctx.deadlinePassed}
              canRevoke={canRevoke(r.status)}
            />
          ) : r.status === "started" ? (
            <span className="small muted">Taking it now</span>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

/** Invite details and actions for a candidate who hasn't finished (prototype "Invite actions" drawer). */
function InviteDrawer({ row, ctx, onClose }: { row: CandidateRow; ctx?: TableContext; onClose: () => void }) {
  const name = candidateLabel(row);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const manageable = ctx?.canManage && (canResend(row.status) || canRevoke(row.status));

  return (
    <aside
      role="dialog"
      aria-labelledby="ia-title"
      style={{
        position: "fixed",
        top: 56,
        right: 0,
        bottom: 0,
        width: 420,
        maxWidth: "100%",
        zIndex: 60,
        background: "#fff",
        borderLeft: "1px solid var(--line)",
        boxShadow: "-12px 0 32px rgba(16,24,40,.06)",
        display: "flex",
        flexDirection: "column",
        animation: "rise .15s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
        <Avatar name={name} size={40} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <h2 id="ia-title" style={{ fontSize: 18 }}>
            {name}
          </h2>
          {row.candidateName ? <span className="small muted">{row.email}</span> : null}
          <span className="xs muted">
            Invited <ShortDate iso={row.invitedAt} />
            {row.lastSentAt ? (
              <>
                {" "}
                · last sent <ShortDate iso={row.lastSentAt} />
                {row.sentCount > 1 ? ` (${row.sentCount} sends)` : ""}
              </>
            ) : null}
            {row.status === "invited" ? (
              <>
                {" "}
                · link works until <ShortDate iso={row.expiresAt} />
              </>
            ) : row.status === "expired" ? (
              <>
                {" "}
                · expired <ShortDate iso={row.expiresAt} />
              </>
            ) : row.status === "revoked" ? (
              " · revoked"
            ) : null}
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <section style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="eyebrow">Invite</span>
        <div>
          <StatusBadge status={row.status} />
        </div>
        {manageable && ctx ? (
          <InviteRowActions
            orgId={ctx.orgId}
            inviteId={row.inviteId}
            email={row.email}
            canResend={canResend(row.status) && !ctx.deadlinePassed}
            canRevoke={canRevoke(row.status)}
          />
        ) : null}
        <p className="xs muted">
          {row.status === "revoked"
            ? "This link no longer works; the candidate sees “Invitation withdrawn”."
            : "Resend sends a new link and the current one stops working. Revoke stops the link; the candidate sees “Invitation withdrawn”. Both only work before the candidate starts."}
          {ctx?.canManage && ctx.deadlinePassed && row.status !== "revoked" ? " The job's invite deadline has passed, so no new links can be sent." : ""}
        </p>
      </section>
      <section style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line)" }}>
        <span className="eyebrow">Accommodations</span>
        {hasAccommodations(row.accommodations) ? (
          <span className="small" data-testid="drawer-accommodations">
            {describeAccommodations(row.accommodations, ctx?.timeLimitMinutes).join(", ")}
          </span>
        ) : (
          <span className="small muted">None</span>
        )}
        {ctx?.canManage && row.status === "invited" ? (
          <AccommodationsForm
            orgId={ctx.orgId}
            inviteId={row.inviteId}
            email={row.email}
            current={row.accommodations}
            camera={ctx.camera}
            screen={ctx.screen}
          />
        ) : null}
      </section>
    </aside>
  );
}
