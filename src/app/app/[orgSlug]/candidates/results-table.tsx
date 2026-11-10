"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  STATUS_FILTER_LABELS,
  STATUS_FILTERS,
  candidateLabel,
  defaultDir,
  filterRows,
  formatDuration,
  sortRows,
  type ResultRow,
  type SortDir,
  type SortKey,
  type StatusFilter,
} from "@/lib/results/summary";
import { LocalDate } from "../jobs/local-date";
import { StatusBadge } from "./status-badge";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "candidate", label: "Candidate" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score", numeric: true },
  { key: "time", label: "Time taken", numeric: true },
  { key: "submitted", label: "Submitted" },
];

export function ResultsTable({ rows, reportBase }: { rows: ResultRow[]; reportBase: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "score", dir: "desc" });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => sortRows(filterRows(rows, status, query), sort.key, sort.dir), [rows, status, query, sort]);

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm font-medium">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f} value={f}>
                {STATUS_FILTER_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm font-medium">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or email"
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
        </label>
        <p className="pb-2 text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
          Showing {visible.length} of {rows.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={`px-4 py-2 font-medium ${c.numeric ? "text-right" : ""}`}
                  >
                    <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 uppercase hover:underline">
                      {c.label}
                      <span aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-neutral-600 dark:text-neutral-400">
                  No candidates match.
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.inviteId}>
                  <td className="px-4 py-2">
                    <Link href={`${reportBase}/${r.inviteId}`} className="font-medium underline-offset-2 hover:underline">
                      {candidateLabel(r)}
                    </Link>
                    {r.candidateName ? <span className="block text-xs text-neutral-600 dark:text-neutral-400">{r.email}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} needsReview={r.needsReview} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.percent === null ? (
                      "—"
                    ) : (
                      <>
                        {r.percent}%
                        <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                          {r.points} / {r.maxPoints}
                          {r.needsReview ? " so far" : ""}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatDuration(r.timeTakenSeconds)}</td>
                  <td className="px-4 py-2">
                    <LocalDate iso={r.submittedAt} withTime />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
