"use client";

import { useId, useState } from "react";
import type { StepComponentProps } from "../../types";
import type { MultipleChoiceAnswer, MultipleChoicePublicConfig } from "./public";

/**
 * Browser half of the `multiple_choice` step type: the prompt as the group's
 * name, then radios (single) or checkboxes (multi), on a card.
 */
export function MultipleChoiceStep({ config, answer, onChange, disabled }: StepComponentProps<MultipleChoicePublicConfig, MultipleChoiceAnswer>) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>(() => answer?.selected ?? []);
  const multi = config.select === "multi";
  const promptId = `${id}-prompt`;
  const helpId = `${id}-help`;

  const pick = (optionId: string, on: boolean) => {
    const next = multi
      ? config.options.map((o) => o.id).filter((x) => (x === optionId ? on : selected.includes(x)))
      : [optionId];
    setSelected(next);
    onChange({ selected: next });
  };

  return (
    <section className="card" style={{ maxWidth: 640, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div role={multi ? "group" : "radiogroup"} aria-labelledby={promptId} aria-describedby={helpId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p id={promptId} className="pre" style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 4 }}>
          {config.prompt}
        </p>
        {config.options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <label
              key={o.id}
              className="row g10"
              style={{
                minHeight: 40,
                padding: "8px 14px",
                borderRadius: 7,
                border: `1px solid ${on ? "var(--accent-line)" : "var(--line-2)"}`,
                background: on ? "var(--accent-soft)" : "#fff",
                color: on ? "var(--accent-ink)" : "var(--ink)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={`${id}-options`}
                value={o.id}
                checked={on}
                disabled={disabled}
                onChange={(e) => pick(o.id, e.target.checked)}
                style={{ accentColor: "var(--accent)", margin: 0 }}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      <p id={helpId} className="small muted">
        {multi ? "Choose all that apply." : "Choose one."}
      </p>
    </section>
  );
}
