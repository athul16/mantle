"use client";

import { useState, useTransition } from "react";
import { StepView } from "@/lib/engine/client/StepView";
import type { AttemptScore, PublicMessage, PublicStep } from "@/lib/engine/types";
import { scoreDemoAttempt } from "./actions";

export function DevWorkspace({
  seed,
  messages,
  steps,
}: {
  seed: string;
  messages: PublicMessage[];
  steps: PublicStep[];
}) {
  const [selectedId, setSelectedId] = useState(messages.at(-1)?.id ?? null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<AttemptScore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = messages.find((m) => m.id === selectedId) ?? null;
  const step = selected?.stepId ? steps.find((s) => s.id === selected.stepId) : undefined;

  return (
    <div className="grid min-h-[480px] grid-cols-1 border border-neutral-200 md:grid-cols-[280px_1fr] dark:border-neutral-800">
      <aside className="border-b border-neutral-200 md:border-r md:border-b-0 dark:border-neutral-800">
        <h2 className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Inbox</h2>
        <ul>
          {messages.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={`w-full px-4 py-3 text-left text-sm ${
                  m.id === selectedId ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="font-medium">{m.from}</div>
                <div className="truncate text-neutral-600 dark:text-neutral-400">{m.subject}</div>
                <div className="text-xs text-neutral-400">minute {m.arriveAtMinute}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="space-y-6 p-6">
        {selected ? (
          <article className="space-y-2">
            <h3 className="text-base font-semibold">{selected.subject}</h3>
            <p className="text-xs text-neutral-500">From {selected.from}</p>
            <p className="text-sm leading-6 whitespace-pre-line">{selected.body}</p>
          </article>
        ) : (
          <p className="text-sm text-neutral-500">No messages yet.</p>
        )}

        {step ? (
          <div className="space-y-3 rounded border border-neutral-200 p-4 dark:border-neutral-800">
            <h4 className="text-sm font-semibold">{step.title}</h4>
            <StepView
              key={step.id}
              step={step}
              answer={answers[step.id]}
              onChange={(a) => setAnswers((prev) => ({ ...prev, [step.id]: a }))}
              disabled={pending}
            />
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  setResult(await scoreDemoAttempt(seed, answers));
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Scoring…" : "Submit and score"}
          </button>
          {error ? <span className="text-sm text-red-600">{error}</span> : null}
        </div>

        {result ? (
          <div className="space-y-2 text-sm" data-testid="score">
            <p className="font-semibold">
              Score: {result.points} / {result.maxPoints}
            </p>
            <ul className="space-y-1">
              {Object.entries(result.steps).map(([id, s]) => (
                <li key={id}>
                  <span className="font-mono">{id}</span>: {s.points}/{s.maxPoints}
                  {s.items.map((i) => (i.note ? ` · ${i.note}` : "")).join("")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
