"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { LocalDate } from "../local-date";
import { CloneAssessmentButton } from "./assessment-forms";
import { LibraryToolbar } from "./library-table";

export type YourAssessmentRow = {
  id: string;
  title: string;
  simulation: string;
  minutes: number;
  passScore: number | null;
  camera: boolean;
  screen: boolean;
  lockedAt: string | null;
  jobs: number;
};

/** The company's own assessments: settings at a glance, lock state, edit and clone. */
export function YourAssessmentsTable({
  orgId,
  rows,
  configureBase,
  canManage,
  tabs,
}: {
  orgId: string;
  rows: YourAssessmentRow[];
  configureBase: string;
  canManage: boolean;
  tabs: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q) || r.simulation.toLowerCase().includes(q));

  return (
    <>
      <LibraryToolbar tabs={tabs} query={query} setQuery={setQuery} placeholder="Search assessments" />
      <section className="card" style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Length</th>
              <th>Pass score</th>
              <th>Monitoring</th>
              <th className="r">Jobs</th>
              <th>Settings</th>
              <th className="r">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "14px 12px" }}>
                  <span className="strong">{r.title}</span>
                  <span className="small muted" style={{ display: "block", marginTop: 2 }}>{r.simulation}</span>
                </td>
                <td className="small tnum" style={{ whiteSpace: "nowrap" }}>{r.minutes} min</td>
                <td className="small tnum">{r.passScore === null ? "—" : r.passScore}</td>
                <td>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span className={r.camera ? "badge" : "badge b-plain"} style={r.camera ? undefined : { color: "var(--ink-3)" }}>
                      Camera {r.camera ? "on" : "off"}
                    </span>
                    <span className={r.screen ? "badge" : "badge b-plain"} style={r.screen ? undefined : { color: "var(--ink-3)" }}>
                      Screen {r.screen ? "on" : "off"}
                    </span>
                  </span>
                </td>
                <td className="r tnum">{r.jobs}</td>
                <td className="small">
                  {r.lockedAt ? (
                    <span className="badge b-warn" title="A candidate started, so these settings can't change. Clone it to change them.">
                      <Icon name="lock" />
                      Locked since <LocalDate iso={r.lockedAt} short />
                    </span>
                  ) : (
                    <span className="muted">Editable</span>
                  )}
                </td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "flex-start" }}>
                    <Link href={`${configureBase}/${r.id}`} className="btn btn-sm" aria-label={`${canManage && !r.lockedAt ? "Edit settings" : "View settings"} for ${r.title}`}>
                      {canManage && !r.lockedAt ? "Edit settings" : "View"}
                    </Link>
                    {canManage ? <CloneAssessmentButton orgId={orgId} assessmentId={r.id} small /> : null}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="small muted" style={{ padding: "20px 12px" }}>
                  {rows.length === 0 ? "None yet. Pick a ready-made simulation and press Use." : "No assessments match."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
