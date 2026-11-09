"use client";

import type { PublicStep } from "../types";
import { renderStepElement } from "./registry";

/** Renders any step by looking up its type's Component. */
export function StepView({
  step,
  answer,
  onChange,
  disabled,
}: {
  step: PublicStep;
  answer?: unknown;
  onChange(answer: unknown): void;
  disabled?: boolean;
}) {
  const element = renderStepElement(step.type, { config: step.config, answer, onChange, disabled });
  return (
    element ?? <p className="text-sm text-red-600">This task type ({step.type}) can&apos;t be shown. Please contact support.</p>
  );
}
