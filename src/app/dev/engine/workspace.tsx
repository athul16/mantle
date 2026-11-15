"use client";

import { useState, useTransition } from "react";
import { StepView } from "@/lib/engine/client/StepView";
import { stepBrief } from "@/lib/engine/client/registry";
import type { AttemptScore, PublicMessage, PublicStep } from "@/lib/engine/types";
import { scoreDemoAttempt } from "./actions";

export function DevWorkspace({
  slug,
  seed,
  messages,
  steps,
}: {
  slug: string;
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
    <div className="card grid min-h-[480px] grid-cols-1 md:grid-cols-[280px_1fr]" style={{ overflow: "hidden" }}>
      <aside style={{ borderRight: "1px solid var(--line)", background: "#fff" }}>
        <h2 className="eyebrow" style={{ padding: "16px 16px 8px", fontFamily: "var(--font)" }}>Inbox</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {messages.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelectedId(m.id)}
                className="cardbtn inboxrow"
                style={{ borderRadius: 0, border: 0, borderBottom: "1px solid var(--line)", background: m.id === selectedId ? "var(--subtle)" : undefined }}
              >
                <div className="font-medium">{m.from}</div>
                <div className="truncate text-neutral-600 dark:text-neutral-400">{m.subject}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">minute {m.arriveAtMinute}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="space-y-6 p-6" style={{ background: "var(--bg)", minWidth: 0 }}>
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
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="col g6" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
              <h4 className="strong">{step.title}</h4>
              {stepBrief(step) ? <p className="small ink2 pre">{stepBrief(step)}</p> : null}
            </div>
            {/* Sheet-style steps fill their container, so give them a height here. */}
            <div style={{ height: step.type === "numeric" || step.type === "inbox_reply" ? "auto" : 520, display: "flex", flexDirection: "column", padding: step.type === "numeric" || step.type === "inbox_reply" ? 16 : 0 }}>
              <StepView
              key={step.id}
              step={step}
              answer={answers[step.id]}
              onChange={(a) => setAnswers((prev) => ({ ...prev, [step.id]: a }))}
              disabled={pending}
            />
            </div>
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
                  setResult(await scoreDemoAttempt(slug, seed, answers));
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
            className="btn btn-dark"
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
                  {s.needsReview ? " (needs review)" : ""}
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
