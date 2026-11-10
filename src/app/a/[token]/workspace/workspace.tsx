"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StepView } from "@/lib/engine/client/StepView";
import type { PublicMessage, PublicStep } from "@/lib/engine/types";

/** Mirrors WorkspaceView from src/lib/candidate/attempt.ts (that module is server-only). */
interface View {
  title: string;
  intro: string;
  messages: PublicMessage[];
  steps: PublicStep[];
  answers: Record<string, unknown>;
  deadlineAt: string;
  serverNow: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const POLL_MS = 20_000;
const SAVE_DEBOUNCE_MS = 700;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function postJson(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function Workspace({ token, initial }: { token: string; initial: View }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial.messages);
  const [steps, setSteps] = useState(initial.steps);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial.answers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deadline] = useState(() => new Date(initial.deadlineAt).getTime());
  // Server time minus browser time, so a wrong local clock doesn't skew the display.
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now());
  const [remaining, setRemaining] = useState(() => deadline - new Date(initial.serverNow).getTime());

  const finished = useRef(false);
  const startedSteps = useRef(new Set<string>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const goDone = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    router.replace(`/a/${token}/done`);
  }, [router, token]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/candidate/state", { cache: "no-store" });
      if (res.status === 401) return router.replace(`/a/${token}`);
      const data = (await res.json()) as { status: string; view?: View };
      if (data.status !== "in_progress" || !data.view) return goDone();
      const view = data.view;
      setMessages(view.messages);
      setSteps(view.steps);
      // Keep what the candidate typed locally; only fill in steps we had nothing for.
      setAnswers((prev) => ({ ...view.answers, ...prev }));
    } catch {
      // Offline for a moment; the next poll retries.
    }
  }, [goDone, router, token]);

  // Countdown (display only) and polling for scheduled messages.
  useEffect(() => {
    const tick = setInterval(() => {
      const left = deadline - (Date.now() + clockOffset);
      setRemaining(left);
      if (left <= 0) void refresh();
    }, 1000);
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [clockOffset, deadline, refresh]);

  const selected = messages.find((m) => m.id === selectedId) ?? null;
  const step = useMemo(
    () => (selected?.stepId ? steps.find((s) => s.id === selected.stepId) : undefined),
    [selected, steps],
  );

  useEffect(() => {
    if (!step || startedSteps.current.has(step.id)) return;
    startedSteps.current.add(step.id);
    void postJson("/api/candidate/event", { kind: "started_step", stepId: step.id }).catch(() => {});
  }, [step]);

  function openMessage(id: string) {
    setSelectedId(id);
    if (!opened.has(id)) {
      setOpened((prev) => new Set(prev).add(id));
      void postJson("/api/candidate/event", { kind: "opened_message", messageId: id }).catch(() => {});
    }
  }

  function changeAnswer(stepId: string, answer: unknown) {
    setAnswers((prev) => ({ ...prev, [stepId]: answer }));
    setSaveState("saving");
    const timers = saveTimers.current;
    clearTimeout(timers.get(stepId));
    timers.set(
      stepId,
      setTimeout(async () => {
        timers.delete(stepId);
        try {
          const res = await postJson("/api/candidate/answer", { stepId, answer });
          if (res.status === 409) return goDone();
          if (res.status === 401) return router.replace(`/a/${token}`);
          setSaveState(res.ok ? (timers.size ? "saving" : "saved") : "error");
        } catch {
          setSaveState("error");
        }
      }, SAVE_DEBOUNCE_MS),
    );
  }

  const lowTime = remaining < 5 * 60_000;
  const saveLabel = { idle: "", saving: "Saving…", saved: "All changes saved", error: "Couldn't save. Check your connection." }[
    saveState
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h1 className="text-sm font-semibold">{initial.title}</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className={saveState === "error" ? "text-red-600" : "text-neutral-500"} aria-live="polite">
            {saveLabel}
          </span>
          <span
            className={`font-mono text-base tabular-nums ${lowTime ? "font-semibold text-red-600" : ""}`}
            title="Time left. The official clock is on our server."
            role="timer"
          >
            {formatRemaining(remaining)}
          </span>
          <Link href={`/a/${token}/review`} className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
            Review and submit
          </Link>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-[300px_1fr]">
        <aside className="border-r border-neutral-200 dark:border-neutral-800">
          <h2 className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Inbox · {messages.filter((m) => !opened.has(m.id)).length} unread
          </h2>
          <ul>
            {messages.map((m) => {
              const unread = !opened.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => openMessage(m.id)}
                    className={`w-full px-4 py-3 text-left text-sm ${
                      m.id === selectedId ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    }`}
                  >
                    <div className={`flex items-center gap-2 ${unread ? "font-semibold" : "font-medium"}`}>
                      {unread ? <span className="size-2 shrink-0 rounded-full bg-blue-600" aria-label="unread" /> : null}
                      <span className="truncate">{m.from}</span>
                    </div>
                    <div className="truncate text-neutral-600 dark:text-neutral-400">{m.subject}</div>
                    <div className="text-xs text-neutral-400">{m.arriveAtMinute === 0 ? "At start" : `${m.arriveAtMinute} min in`}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="space-y-6 p-6">
          {selected ? (
            <>
              <article className="space-y-2">
                <h3 className="text-base font-semibold">{selected.subject}</h3>
                <p className="text-xs text-neutral-500">From {selected.from}</p>
                <p className="text-sm leading-6 whitespace-pre-line">{selected.body}</p>
              </article>
              {step ? (
                <div className="space-y-3 rounded border border-neutral-200 p-4 dark:border-neutral-800">
                  <h4 className="text-sm font-semibold">{step.title}</h4>
                  <StepView key={step.id} step={step} answer={answers[step.id]} onChange={(a) => changeAnswer(step.id, a)} />
                </div>
              ) : null}
            </>
          ) : (
            <div className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <p className="leading-6 whitespace-pre-line">{initial.intro}</p>
              <p>Open a message in the inbox to start.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
