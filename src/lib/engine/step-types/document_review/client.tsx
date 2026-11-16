"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import type { StepComponentProps } from "../../types";
import type { DocumentFlag, DocumentReviewAnswer, DocumentReviewPublicConfig } from "./public";

const FLAGGED = { background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" } as const;
const BAD_BG = "var(--bad-bg)";

/**
 * Browser half of the `document_review` step type: the document (read-only)
 * with a Flag toggle on every header field, line and total. A flagged item
 * asks for a reason and an optional note. Optional final decision below the
 * document. The prompt is shown by the page (the workspace's brief column).
 * When the config offers it, a "nothing wrong here" confirm lets the candidate
 * say the document is clean instead of flagging something; confirming and
 * flagging exclude each other.
 */
export function DocumentReviewStep({
  config,
  answer,
  onChange,
  disabled,
}: StepComponentProps<DocumentReviewPublicConfig, DocumentReviewAnswer>) {
  const [flags, setFlags] = useState<DocumentFlag[]>(() => answer?.flags ?? []);
  const [decision, setDecision] = useState<string | null>(() => answer?.decision ?? null);
  const [clean, setClean] = useState<boolean>(() => answer?.clean === true);
  const cleanHintId = useId();
  const doc = config.document;

  // `clean` is sent only when the config offers the confirm, so other answers keep their old shape.
  const emit = (nextFlags: DocumentFlag[], nextDecision: string | null, nextClean = clean) => {
    setFlags(nextFlags);
    setDecision(nextDecision);
    setClean(nextClean);
    onChange({ flags: nextFlags, decision: nextDecision, ...(config.confirmClean ? { clean: nextClean } : {}) });
  };
  const flagOf = (id: string) => flags.find((f) => f.target === id);
  const toggle = (id: string) =>
    emit(flagOf(id) ? flags.filter((f) => f.target !== id) : [...flags, { target: id, reason: "", note: "" }], decision);
  const patch = (id: string, p: Partial<DocumentFlag>) =>
    emit(flags.map((f) => (f.target === id ? { ...f, ...p } : f)), decision);
  const full = flags.length >= config.maxFlags;
  const confirmed = !!config.confirmClean && clean;

  // Plain render helpers, not components: a component defined in render remounts
  // every keystroke and the note input would lose focus.
  const flagButton = (id: string, name: string) => {
    const on = !!flagOf(id);
    return (
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={on}
        aria-label={`Flag ${name}`}
        disabled={disabled || (!on && (full || confirmed))}
        onClick={() => toggle(id)}
        style={on ? FLAGGED : undefined}
      >
        {on ? "Flagged" : "Flag"}
      </button>
    );
  };

  const flagDetails = (id: string, name: string) => {
    const f = flagOf(id);
    if (!f) return null;
    return (
      <div className="row g10 wrap" style={{ alignItems: "flex-end" }}>
        <label className="col xs ink2" style={{ gap: 4 }}>
          Reason
          <select
            aria-label={`Reason for ${name}`}
            disabled={disabled}
            value={f.reason}
            onChange={(e) => patch(id, { reason: e.target.value })}
            className="select"
            style={{ height: 30, fontSize: 13, width: 220 }}
          >
            <option value="">Choose a reason…</option>
            {config.reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="col xs ink2" style={{ gap: 4, flex: "1 1 240px" }}>
          Note (optional)
          <input
            type="text"
            aria-label={`Note for ${name}`}
            maxLength={500}
            disabled={disabled}
            value={f.note}
            placeholder="Add a short note"
            onChange={(e) => patch(id, { note: e.target.value })}
            className="input"
            style={{ height: 30, fontSize: 13 }}
          />
        </label>
      </div>
    );
  };

  const fieldRows = (fields: typeof doc.fields, align: "left" | "right") =>
    fields.map((f, i) => {
      const on = !!flagOf(f.id);
      const lastRow = i === fields.length - 1;
      const band = on ? { background: BAD_BG, margin: "0 -20px", paddingLeft: 20, paddingRight: 20 } : {};
      return (
        <div key={f.id}>
          <div
            className="row g12"
            style={{ padding: "8px 0", borderBottom: lastRow && !on ? 0 : "1px solid var(--line)", ...band }}
          >
            {align === "right" ? <span className="grow" /> : null}
            <dt className={align === "right" ? "strong" : "muted"} style={{ width: 140, flex: "none", textAlign: align }}>
              {f.label}
            </dt>
            <dd className="tnum" style={{ margin: 0, flex: align === "right" ? "none" : 1, minWidth: align === "right" ? 120 : undefined, textAlign: align, fontWeight: on ? 600 : undefined }}>
              {f.value}
            </dd>
            {flagButton(f.id, f.label)}
          </div>
          {on ? (
            <div style={{ padding: "10px 0 12px", borderBottom: "1px solid var(--line)", ...band }}>{flagDetails(f.id, f.label)}</div>
          ) : null}
        </div>
      );
    });

  return (
    <div className="sheet-step" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="roband">
        <Icon name="file" className="i-sm" />
        <span>{doc.title} · document is read-only; use the Flag buttons</span>
        <span className="grow" />
        <span className="badge" role="status">
          {flags.length} of {config.maxFlags} flags used
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, background: "var(--bg)" }}>
        <article className="card" aria-label={doc.title} style={{ maxWidth: 860, overflow: "hidden", flex: "none" }}>
          <div className="row g12" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <h2 style={{ fontSize: 18 }}>{doc.title}</h2>
          </div>

          {doc.fields.length > 0 ? <dl style={{ margin: 0, padding: "8px 20px", fontSize: 13 }}>{fieldRows(doc.fields, "left")}</dl> : null}

          {doc.rows.length > 0 ? (
            <table className="tbl" style={{ borderTop: "1px solid var(--line)" }}>
              <thead>
                <tr>
                  {doc.columns.map((c, i) => (
                    <th key={i} scope="col" className={i > 0 ? "r" : undefined}>
                      {c}
                    </th>
                  ))}
                  <th scope="col" style={{ width: 100 }}>
                    <span className="sr">Flag</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {doc.rows.map((r) => {
                  const name = r.cells[0] ?? r.id;
                  const on = !!flagOf(r.id);
                  const bg = on ? { background: BAD_BG } : undefined;
                  return [
                    <tr key={r.id}>
                      {r.cells.map((cell, i) => (
                        <td key={i} className={i > 0 ? "r tnum" : undefined} style={bg}>
                          {cell}
                        </td>
                      ))}
                      <td className="r" style={bg}>
                        {flagButton(r.id, name)}
                      </td>
                    </tr>,
                    on ? (
                      <tr key={`${r.id}-flag`}>
                        <td colSpan={doc.columns.length + 1} style={{ ...bg, paddingTop: 0 }}>
                          {flagDetails(r.id, name)}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          ) : null}

          {doc.totals.length > 0 ? (
            <dl style={{ margin: 0, padding: "8px 20px", fontSize: 13, borderTop: "1px solid var(--line)" }}>{fieldRows(doc.totals, "right")}</dl>
          ) : null}
          {doc.footnote ? (
            <p className="xs muted pre" style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
              {doc.footnote}
            </p>
          ) : null}
        </article>

        {config.confirmClean ? (
          <div className="card" style={{ maxWidth: 860, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
            <label className="row g10 strong" style={{ cursor: disabled || flags.length > 0 ? "not-allowed" : "pointer" }}>
              <input
                type="checkbox"
                checked={clean}
                disabled={disabled || flags.length > 0}
                aria-describedby={flags.length > 0 ? cleanHintId : undefined}
                onChange={(e) => emit(flags, decision, e.target.checked)}
                style={{ accentColor: "var(--accent)", margin: 0, width: 16, height: 16 }}
              />
              {config.confirmClean.label}
            </label>
            {flags.length > 0 ? (
              <p id={cleanHintId} className="xs muted">
                Remove your flags to confirm the document is clean.
              </p>
            ) : confirmed ? (
              <p className="xs muted">Remove the confirmation to flag items.</p>
            ) : null}
          </div>
        ) : null}

        {config.decision ? (
          <fieldset className="card" style={{ maxWidth: 860, padding: "20px 20px", margin: 0, display: "flex", flexDirection: "column", gap: 12, flex: "none" }}>
            <legend className="strong" style={{ float: "left", padding: 0, marginBottom: 12 }}>
              {config.decision.prompt}
            </legend>
            <div className="row g10 wrap" style={{ clear: "both" }}>
              {config.decision.options.map((o) => {
                const on = decision === o.id;
                return (
                  <label
                    key={o.id}
                    className="row g8"
                    style={{
                      height: 36,
                      padding: "0 14px",
                      borderRadius: 7,
                      border: `1px solid ${on ? "var(--accent-line)" : "var(--line-2)"}`,
                      background: on ? "var(--accent-soft)" : "#fff",
                      color: on ? "var(--accent-ink)" : "var(--ink)",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="document-review-decision"
                      value={o.id}
                      disabled={disabled}
                      checked={on}
                      onChange={() => emit(flags, o.id)}
                      style={{ accentColor: "var(--accent)", margin: 0 }}
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}
