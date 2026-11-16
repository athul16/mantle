"use client";

import { useEffect, useId, useState } from "react";
import type { StepComponentProps } from "../../types";
import { isNumberField, type RapidItem, type RapidRoundAnswer, type RapidRoundPublicConfig } from "./public";

/** "0:18" — the item countdown text. */
function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Display-only countdown to the server's item deadline; the server refuses late answers itself. */
function ItemTimer({ endsAt }: { endsAt: string }) {
  const deadline = new Date(endsAt).getTime();
  const [left, setLeft] = useState(() => deadline - Date.now());
  useEffect(() => {
    const tick = setInterval(() => setLeft(deadline - Date.now()), 250);
    return () => clearInterval(tick);
  }, [deadline]);
  const secs = Math.max(0, Math.ceil(left / 1000));
  return (
    <span
      className={secs <= 5 ? "timer low" : "timer"}
      role="timer"
      aria-label={`${secs} seconds left for this item`}
      suppressHydrationWarning
    >
      {mmss(left)}
    </span>
  );
}

/** "1,250.50" or "$ 1250.5" → 1250.5; null when it isn't a number. */
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s$]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function ItemForm({
  item,
  index,
  disabled,
  onSubmit,
}: {
  item: RapidItem;
  index: number;
  disabled?: boolean;
  onSubmit(values: Record<string, string | number>): void;
}) {
  const uid = useId();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const values: Record<string, string | number> = {};
  let complete = true;
  for (const f of item.fields) {
    if (isNumberField(f)) {
      const n = parseAmount(texts[f.id] ?? "");
      if (n === null) complete = false;
      else values[f.id] = n;
    } else if (choices[f.id]) values[f.id] = choices[f.id];
    else complete = false;
  }

  return (
    <form
      className="col g16"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete || sent) return;
        setSent(true);
        onSubmit(values);
      }}
    >
      <p className="pre" style={{ fontSize: 16, lineHeight: 1.6 }}>
        {item.prompt}
      </p>
      {item.exhibit ? (
        <figure className="card" style={{ margin: 0, padding: 16, background: "var(--subtle)" }}>
          {item.exhibit.title ? <figcaption className="strong small" style={{ marginBottom: 8 }}>{item.exhibit.title}</figcaption> : null}
          {item.exhibit.rows?.length ? (
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", margin: 0 }}>
              {item.exhibit.rows.map((r, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <dt className="small ink2">{r.label}</dt>
                  <dd className="small tnum" style={{ margin: 0 }}>
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {item.exhibit.table ? (
            <table className="tbl" style={{ fontSize: 13, marginTop: item.exhibit.rows?.length ? 12 : 0 }}>
              <thead>
                <tr>
                  {item.exhibit.table.columns.map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.exhibit.table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className="tnum">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </figure>
      ) : null}

      {item.fields.map((f) => {
        const labelId = `${uid}-${f.id}-label`;
        if (isNumberField(f)) {
          const inputId = `${uid}-${f.id}`;
          return (
            <div key={f.id} className="col g6">
              <label htmlFor={inputId} className="strong small">
                {f.label}
              </label>
              <div className="row g10">
                {f.unit ? <span className="strong muted">{f.unit}</span> : null}
                <input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="input tnum"
                  disabled={disabled || sent}
                  value={texts[f.id] ?? ""}
                  placeholder={f.decimals > 0 ? `0.${"0".repeat(f.decimals)}` : "0"}
                  onChange={(e) => setTexts((t) => ({ ...t, [f.id]: e.target.value }))}
                  style={{ width: 200, height: 40, fontSize: 16, fontWeight: 600 }}
                />
              </div>
            </div>
          );
        }
        return (
          <div key={f.id} role="radiogroup" aria-labelledby={labelId} className="col g6">
            <span id={labelId} className="strong small">
              {f.label}
            </span>
            <div className="row g8 wrap">
              {f.options.map((o) => (
                <label key={o.id} className="btn btn-sm" style={{ gap: 6, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={`${uid}-${f.id}`}
                    value={o.id}
                    checked={choices[f.id] === o.id}
                    disabled={disabled || sent}
                    onChange={() => setChoices((c) => ({ ...c, [f.id]: o.id }))}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}

      <div className="row g10">
        <button type="submit" className="btn btn-primary" disabled={disabled || sent || !complete}>
          {sent ? "Submitting…" : "Submit answer"}
        </button>
        <span className="small muted">Item {index + 1} can&apos;t be changed once submitted.</span>
      </div>
    </form>
  );
}

/**
 * Browser half of the `rapid_round` step type: the current item only, with its
 * own countdown. "Submit answer" sends the item at once (`onCommit`); the
 * server then moves on to the next item. When an item times out the page
 * refreshes and the next one appears. Display only: the server times every item.
 */
export function RapidRoundStep({ config, disabled, onChange, onCommit }: StepComponentProps<RapidRoundPublicConfig, RapidRoundAnswer>) {
  const current = config.current;
  return (
    <section className="card" style={{ maxWidth: 720, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {current ? (
        <>
          <div className="row g10">
            <span className="eyebrow">{`Item ${current.index + 1} of ${current.count}`}</span>
            <span className="grow" />
            <ItemTimer endsAt={current.endsAt} />
          </div>
          <ItemForm
            key={current.index}
            item={current.item}
            index={current.index}
            disabled={disabled}
            onSubmit={(values) => {
              const submission = { index: current.index, values };
              if (onCommit) onCommit(submission);
              else (onChange as (a: unknown) => void)(submission);
            }}
          />
        </>
      ) : (
        <>
          {config.intro ? <p className="pre" style={{ fontSize: 15, lineHeight: 1.6 }}>{config.intro}</p> : null}
          <p className="small ink2">
            {config.done
              ? `All ${config.itemCount} items are done. Finish the section to move on.`
              : `${config.itemCount} quick items, ${config.secondsPerItem} seconds each. Each item moves on when you submit it or its time runs out.`}
          </p>
        </>
      )}
    </section>
  );
}
