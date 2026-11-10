"use client";

import { useState } from "react";
import type { StepComponentProps } from "../../types";
import type { DocumentFlag, DocumentReviewAnswer, DocumentReviewPublicConfig } from "./public";

/**
 * Browser half of the `document_review` step type: the document with a Flag
 * toggle on every header field, line and total. A flagged item asks for a
 * reason (and an optional note). Optional final decision below the document.
 */
export function DocumentReviewStep({
  config,
  answer,
  onChange,
  disabled,
}: StepComponentProps<DocumentReviewPublicConfig, DocumentReviewAnswer>) {
  const [flags, setFlags] = useState<DocumentFlag[]>(() => answer?.flags ?? []);
  const [decision, setDecision] = useState<string | null>(() => answer?.decision ?? null);
  const doc = config.document;

  const emit = (nextFlags: DocumentFlag[], nextDecision: string | null) => {
    setFlags(nextFlags);
    setDecision(nextDecision);
    onChange({ flags: nextFlags, decision: nextDecision });
  };
  const flagOf = (id: string) => flags.find((f) => f.target === id);
  const toggle = (id: string) =>
    emit(flagOf(id) ? flags.filter((f) => f.target !== id) : [...flags, { target: id, reason: "", note: "" }], decision);
  const patch = (id: string, p: Partial<DocumentFlag>) =>
    emit(flags.map((f) => (f.target === id ? { ...f, ...p } : f)), decision);
  const full = flags.length >= config.maxFlags;

  // Plain render helpers, not components: a component defined in render remounts
  // every keystroke and the note input would lose focus.
  const flagButton = (id: string, name: string) => {
    const on = !!flagOf(id);
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={`Flag ${name}`}
        disabled={disabled || (!on && full)}
        onClick={() => toggle(id)}
        className={`rounded border px-2 py-0.5 text-xs whitespace-nowrap disabled:opacity-40 ${
          on ? "border-red-600 bg-red-600 text-white" : "border-neutral-300 dark:border-neutral-700"
        }`}
      >
        {on ? "Flagged" : "Flag"}
      </button>
    );
  };

  const flagDetails = (id: string, name: string) => {
    const f = flagOf(id);
    if (!f) return null;
    return (
      <div className="flex flex-wrap items-end gap-2 bg-red-50 px-2 py-2 text-xs dark:bg-red-950/30">
        <label className="flex flex-col gap-1">
          Reason
          <select
            aria-label={`Reason for ${name}`}
            disabled={disabled}
            value={f.reason}
            onChange={(e) => patch(id, { reason: e.target.value })}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Choose a reason…</option>
            {config.reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          Note (optional)
          <input
            type="text"
            aria-label={`Note for ${name}`}
            maxLength={500}
            disabled={disabled}
            value={f.note}
            onChange={(e) => patch(id, { note: e.target.value })}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>
    );
  };

  const fieldList = (fields: typeof doc.fields, align: "left" | "right") => (
    <dl className={`space-y-1 text-sm ${align === "right" ? "ml-auto max-w-md" : ""}`}>
      {fields.map((f) => (
        <div key={f.id}>
          <div className="flex items-center gap-2">
            <dt className="w-36 shrink-0 text-neutral-500">{f.label}</dt>
            <dd className={`flex-1 font-mono ${align === "right" ? "text-right" : ""}`}>{f.value}</dd>
            {flagButton(f.id, f.label)}
          </div>
          {flagDetails(f.id, f.label)}
        </div>
      ))}
    </dl>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 whitespace-pre-line">{config.prompt}</p>

      <article aria-label={doc.title} className="space-y-4 rounded border border-neutral-300 p-4 dark:border-neutral-700">
        <h4 className="text-base font-semibold">{doc.title}</h4>
        {doc.fields.length > 0 && fieldList(doc.fields, "left")}

        {doc.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {doc.columns.map((c, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="border-b border-neutral-300 px-2 py-1 text-left font-medium dark:border-neutral-700"
                    >
                      {c}
                    </th>
                  ))}
                  <th scope="col" className="border-b border-neutral-300 px-2 py-1 dark:border-neutral-700">
                    <span className="sr-only">Flag</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {doc.rows.map((r) => {
                  const name = r.cells[0] ?? r.id;
                  const on = !!flagOf(r.id);
                  return [
                    <tr key={r.id} className={on ? "bg-red-50 dark:bg-red-950/30" : ""}>
                      {r.cells.map((cell, i) => (
                        <td key={i} className={`px-2 py-1 ${i > 0 && /^[-$(\d]/.test(cell) ? "text-right font-mono" : ""}`}>
                          {cell}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right">
                        {flagButton(r.id, name)}
                      </td>
                    </tr>,
                    on && (
                      <tr key={`${r.id}-flag`}>
                        <td colSpan={doc.columns.length + 1} className="p-0">
                          {flagDetails(r.id, name)}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}

        {doc.totals.length > 0 && fieldList(doc.totals, "right")}
        {doc.footnote && <p className="text-xs whitespace-pre-line text-neutral-500">{doc.footnote}</p>}
      </article>

      <p className="text-xs text-neutral-500">
        {flags.length} of {config.maxFlags} flags used. Flag only real issues: flags on items that are fine cost points.
      </p>

      {config.decision && (
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">{config.decision.prompt}</legend>
          {config.decision.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="document-review-decision"
                value={o.id}
                disabled={disabled}
                checked={decision === o.id}
                onChange={() => emit(flags, o.id)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
