"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";

export type LibraryRow = {
  id: string;
  title: string;
  family: string;
  familyLabel: string;
  minutes: number;
  /** What candidates do: one label per step type. */
  activities: string[];
  intro: string;
};

/** The Ready-made tab: search, role-family filter and the simulation table. */
export function LibraryTable({ rows, configureBase, canManage, tabs }: { rows: LibraryRow[]; configureBase: string; canManage: boolean; tabs: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const families = [...new Map(rows.map((r) => [r.family, r.familyLabel])).entries()];
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (!family || r.family === family) && (!q || r.title.toLowerCase().includes(q) || r.intro.toLowerCase().includes(q)));

  return (
    <>
      <LibraryToolbar tabs={tabs} query={query} setQuery={setQuery}>
        <div className="seg" role="group" aria-label="Role family">
          <button type="button" className={family === null ? "on" : ""} aria-pressed={family === null} onClick={() => setFamily(null)}>
            All
          </button>
          {families.map(([key, label]) => (
            <button key={key} type="button" className={family === key ? "on" : ""} aria-pressed={family === key} onClick={() => setFamily(key)}>
              {label}
            </button>
          ))}
        </div>
      </LibraryToolbar>
      <section className="card" style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <th>Simulation</th>
              <th>Role</th>
              <th>Length</th>
              <th>What candidates do</th>
              {canManage ? <th className="r">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "14px 12px", maxWidth: 520 }}>
                  <span className="strong">{r.title}</span>
                  <span
                    className="small muted"
                    style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 2 }}
                  >
                    {r.intro}
                  </span>
                </td>
                <td className="small">{r.familyLabel}</td>
                <td className="small tnum" style={{ whiteSpace: "nowrap" }}>{r.minutes} min</td>
                <td>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {r.activities.map((a) => (
                      <span key={a} className="badge">{a}</span>
                    ))}
                  </span>
                </td>
                {canManage ? (
                  <td className="r" style={{ whiteSpace: "nowrap" }}>
                    <Link href={`${configureBase}/new?scenario=${r.id}`} className="btn btn-sm btn-primary" aria-label={`Use ${r.title}`}>
                      Use
                    </Link>
                  </td>
                ) : null}
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="small muted" style={{ padding: "20px 12px" }}>
                  {rows.length === 0 ? "No published simulations yet." : "No simulations match."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** The tabs row: tabs on the left, then the search box and `children` (a filter) on the right. */
export function LibraryToolbar({
  tabs,
  query,
  setQuery,
  children,
  placeholder = "Search simulations",
}: {
  tabs: React.ReactNode;
  query: string;
  setQuery: (q: string) => void;
  children?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {tabs}
      <span style={{ flex: 1 }} />
      <div style={{ position: "relative", width: 260 }}>
        <span style={{ position: "absolute", left: 10, top: 10, display: "flex" }}>
          <Icon name="search" className="muted" />
        </span>
        <input className="input" style={{ paddingLeft: 34 }} placeholder={placeholder} aria-label={placeholder} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </div>
      {children}
    </div>
  );
}
