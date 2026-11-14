"use client";

import { useId, useState } from "react";
import type { StepComponentProps } from "../../types";
import type { NumericAnswer, NumericPublicConfig } from "./public";

/** Browser half of the `numeric` step type: the question and one number input, on a card. */
export function NumericStep({ config, answer, onChange, disabled }: StepComponentProps<NumericPublicConfig, NumericAnswer>) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  // Keep the raw text so "12." or "-" can be typed without being normalised away.
  const [text, setText] = useState(answer?.value == null ? "" : String(answer.value));

  return (
    <section className="card" style={{ maxWidth: 640, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <label htmlFor={inputId} className="pre" style={{ fontSize: 15, lineHeight: 1.6 }}>
        {config.prompt}
      </label>
      <div className="row g10">
        {config.unit ? (
          <span className="strong muted" style={{ fontSize: 18 }}>
            {config.unit}
          </span>
        ) : null}
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-describedby={helpId}
          disabled={disabled}
          value={text}
          placeholder={config.decimals > 0 ? `0.${"0".repeat(config.decimals)}` : "0"}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const cleaned = next.replace(/[,\s$]/g, "");
            const parsed = cleaned === "" ? null : Number(cleaned);
            onChange({ value: parsed === null || Number.isFinite(parsed) ? parsed : null });
          }}
          className="input tnum"
          style={{ width: 220, height: 44, fontSize: 18, fontWeight: 600 }}
        />
      </div>
      <p id={helpId} className="small muted">
        Numbers only. You can use the calculator, and change your answer until you submit.
      </p>
    </section>
  );
}
