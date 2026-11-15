"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { buildCsv, type CandidateRow } from "@/lib/results/candidate-table";

type Who = "selected" | "matching" | "everyone";

/**
 * Export results (prototype "Export results" dialog). CSV only: the file is
 * built in the browser from the rows already on the page, so it holds exactly
 * what this member can see.
 */
export function ExportDialog({
  jobTitle,
  selected,
  matching,
  everyone,
  filtered,
  onClose,
}: {
  jobTitle: string;
  selected: CandidateRow[];
  matching: CandidateRow[];
  everyone: CandidateRow[];
  filtered: boolean;
  onClose: () => void;
}) {
  const [who, setWho] = useState<Who>(selected.length ? "selected" : filtered ? "matching" : "everyone");
  const [opts, setOpts] = useState({ scores: true, integrity: true, votes: true });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = who === "selected" ? selected : who === "matching" ? matching : everyone;

  function download() {
    const blob = new Blob([buildCsv(rows, opts)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${jobTitle.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "candidates"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  }

  const radio = (value: Who, label: string, count: number | null, disabled = false) => (
    <label className="small" style={{ display: "flex", gap: 10, alignItems: "center", color: disabled ? "var(--ink-3)" : undefined }}>
      <input type="radio" name="who" checked={who === value} disabled={disabled} onChange={() => setWho(value)} style={{ accentColor: "var(--ink)" }} />
      {label}
      {count !== null ? <span className="muted">({count})</span> : null}
    </label>
  );
  const check = (key: keyof typeof opts, label: string) => (
    <label className="small" style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <input type="checkbox" className="chk" checked={opts[key]} onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))} />
      {label}
    </label>
  );

  return (
    <div className="mwrap" style={{ paddingTop: 96 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="ex-title" className="mbox" style={{ maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "20px 24px 4px" }}>
          <h2 id="ex-title" style={{ fontSize: 20 }}>
            Export results
          </h2>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div style={{ padding: "12px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <legend className="label">Format</legend>
            <label style={{ display: "flex", gap: 10, padding: 12, border: "2px solid var(--ink)", borderRadius: 8 }}>
              <input type="radio" name="fmt" checked readOnly style={{ accentColor: "var(--ink)", marginTop: 2 }} />
              <span>
                <span className="strong small" style={{ display: "block" }}>
                  CSV
                </span>
                <span className="xs muted">One row per candidate</span>
              </span>
            </label>
          </fieldset>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="label">Candidates</legend>
            {radio("selected", `${selected.length} selected`, null, selected.length === 0)}
            {radio("matching", "Matching current filters", matching.length)}
            {radio("everyone", "Everyone in this job", everyone.length)}
          </fieldset>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="label">Include</legend>
            {check("scores", "Overall score, percentile and per-task scores")}
            {check("integrity", "Integrity label and flag count")}
            {check("votes", "Team votes")}
          </fieldset>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 24px 22px", borderTop: "1px solid var(--line)", marginTop: 8 }}>
          <span className="xs muted">Name, email, status, time taken and submit time are always included.</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={download} disabled={rows.length === 0}>
            <Icon name="download" />
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
