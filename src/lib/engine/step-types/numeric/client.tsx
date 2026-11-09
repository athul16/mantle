"use client";

import { useId, useState } from "react";
import type { StepComponentProps } from "../../types";
import type { NumericAnswer, NumericPublicConfig } from "./public";

/** Browser half of the `numeric` step type: a prompt and one number input. */
export function NumericStep({ config, answer, onChange, disabled }: StepComponentProps<NumericPublicConfig, NumericAnswer>) {
  const inputId = useId();
  // Keep the raw text so "12." or "-" can be typed without being normalised away.
  const [text, setText] = useState(answer?.value == null ? "" : String(answer.value));

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block whitespace-pre-line text-sm leading-6">
        {config.prompt}
      </label>
      <div className="flex items-center gap-2">
        {config.unit ? <span className="text-sm text-neutral-500">{config.unit}</span> : null}
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
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
          className="w-48 rounded border border-neutral-300 px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
    </div>
  );
}
