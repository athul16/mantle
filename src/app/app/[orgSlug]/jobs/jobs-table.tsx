"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { LocalDate } from "./local-date";

/** One row of the jobs table, already shaped on the server. */
export type JobRow = {
  id: string;
  title: string;
  /** "Simulation title · 30 min" */
  simulation: string;
  deadline: string | null;
  /** Invites closed: the deadline has passed. */
  closed: boolean;
  done: number;
  inProgress: number;
  notStarted: number;
};

const segment = { color: "#fff", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" } as const;

/** Done · in progress · not started, as one stacked bar. */
function ProgressBar({ done, inProgress, notStarted }: { done: number; inProgress: number; notStarted: number }) {
  const total = done + inProgress + notStarted;
  const pct = (n: number) => `${(100 * n) / total}%`;
  return (
    <div
      className="bar"
      style={{ width: 240, height: 20, borderRadius: 5 }}
      role="img"
      aria-label={`${done} done, ${inProgress} in progress, ${notStarted} not started`}
    >
      {done ? <span style={{ ...segment, width: pct(done), background: "var(--ink-2)" }}>{done}</span> : null}
      {inProgress ? <span style={{ ...segment, width: pct(inProgress), background: "var(--accent)" }}>{inProgress}</span> : null}
      {notStarted ? <span style={{ ...segment, flex: 1, color: "var(--ink-2)" }}>{notStarted}</span> : null}
    </div>
  );
}

/**
 * The jobs list from the prototype: search, Active / Inactive filter and the
 * table. "Inactive" means the job's invites have closed (deadline passed).
 */
export function JobsTable({ jobs, base, canManage }: { jobs: JobRow[]; base: string; canManage: boolean }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"active" | "inactive">("active");
  const active = jobs.filter((j) => !j.closed);
  const inactive = jobs.filter((j) => j.closed);
  const q = query.trim().toLowerCase();
  const rows = (show === "active" ? active : inactive).filter((j) => !q || j.title.toLowerCase().includes(q) || j.simulation.toLowerCase().includes(q));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 280 }}>
          <span style={{ position: "absolute", left: 10, top: 10, display: "flex" }}>
            <Icon name="search" className="muted" />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 34 }}
            placeholder="Search jobs"
            aria-label="Search jobs"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <span style={{ flex: 1 }} />
        <div className="seg" role="group" aria-label="Job status">
          <button type="button" className={show === "active" ? "on" : ""} aria-pressed={show === "active"} onClick={() => setShow("active")}>
            Active ({active.length})
          </button>
          <button type="button" className={show === "inactive" ? "on" : ""} aria-pressed={show === "inactive"} onClick={() => setShow("inactive")}>
            Inactive ({inactive.length})
          </button>
        </div>
      </div>
      <section className="card" style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <th>Role</th>
              <th>Simulation</th>
              <th className="r">Candidates</th>
              <th>
                Progress <span style={{ fontWeight: 400 }}>· done · in progress · not started</span>
              </th>
              <th>Invites close</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => {
              const total = j.done + j.inProgress + j.notStarted;
              return (
                <tr key={j.id} style={{ height: 53 }}>
                  <td>
                    <Link href={`${base}/${j.id}`} className="strong" style={{ color: "var(--ink)" }}>
                      {j.title}
                    </Link>
                  </td>
                  <td className="small ink2">{j.simulation}</td>
                  <td className="r tnum">{total}</td>
                  <td>
                    {total ? (
                      <ProgressBar done={j.done} inProgress={j.inProgress} notStarted={j.notStarted} />
                    ) : (
                      <span className="small muted">
                        No invites yet
                        {canManage && !j.closed ? (
                          <>
                            {" · "}
                            <Link style={{ textDecoration: "underline", textUnderlineOffset: 2 }} href={`${base}/${j.id}/invite`}>Invite candidates</Link>
                          </>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="small">
                    <LocalDate iso={j.deadline} short />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="small muted" style={{ padding: "20px 12px" }}>
                  {q ? "No jobs match your search." : show === "active" ? "No active jobs." : "No jobs with closed invites."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
