"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/brand";
import { Icon } from "@/components/icons";
import { StepView } from "@/lib/engine/client/StepView";
import { stepBrief } from "@/lib/engine/client/registry";
import type { PublicMessage, PublicStep } from "@/lib/engine/types";
import { FullscreenButton, Proctoring, ProctoringIndicators } from "@/lib/proctoring/client/proctoring";
import type { Proctoring as ProctoringSettings } from "@/lib/proctoring/config";
import { Calculator } from "./calculator";
import { hasAnswer, isWorkbookStep, senderParts, shortLabel } from "./labels";
import { ClockTime, TimerBadge } from "./parts";

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
const RETRY_MS = 5_000;
const ONE_MINUTE_MS = 60_000;

function postJson(url: string, body: unknown, init?: RequestInit) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
}

const NO_PROCTORING: ProctoringSettings = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false};

/**
 * The timed workspace (prototype "workspace B"): a header with the clock,
 * tasks, inbox, monitoring and save status; a brief column for the current
 * task; and the task itself. Messages and steps come from the server clock
 * (elapsed since attempts.started_at); the countdown is display only.
 *
 * `openedIds`: messages already opened in this attempt (from the server's
 * action events), so they stay read after a reload. `proctoring`: the
 * assessment's camera / screen settings; browser signals are recorded either
 * way. `startedAt` turns message arrival minutes into clock times.
 */
export function Workspace({
  token,
  initial,
  openedIds = [],
  proctoring = NO_PROCTORING,
  companyName,
  startedAt,
  initialTaskId,
}: {
  token: string;
  initial: View;
  openedIds?: string[];
  proctoring?: ProctoringSettings;
  companyName?: string;
  startedAt?: string | null;
  initialTaskId?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial.messages);
  const [steps, setSteps] = useState(initial.steps);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial.answers);
  const [taskId, setTaskId] = useState<string | null>(
    () => initial.steps.find((s) => s.id === initialTaskId)?.id ?? initial.steps[0]?.id ?? null,
  );
  const [opened, setOpened] = useState<Set<string>>(() => new Set(openedIds));
  const [drawer, setDrawer] = useState<{ open: boolean; messageId: string | null }>({ open: false, messageId: null });
  const [toastId, setToastId] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [oneMinuteDismissed, setOneMinuteDismissed] = useState(false);
  const [deadline] = useState(() => new Date(initial.deadlineAt).getTime());
  // Server time minus browser time, so a wrong local clock doesn't skew the display.
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now());
  const [remaining, setRemaining] = useState(() => deadline - new Date(initial.serverNow).getTime());

  const finished = useRef(false);
  const startedSteps = useRef(new Set<string>());
  const knownMessages = useRef(new Set(initial.messages.map((m) => m.id)));
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const failed = useRef(new Map<string, unknown>());

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
      // A message that wasn't there before has just arrived: announce the newest one.
      const arrived = view.messages.filter((m) => !knownMessages.current.has(m.id));
      arrived.forEach((m) => knownMessages.current.add(m.id));
      if (arrived.length) setToastId(arrived[0].id);
      setMessages(view.messages);
      setSteps(view.steps);
      setTaskId((current) => current ?? view.steps[0]?.id ?? null);
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

  const step = useMemo(() => steps.find((s) => s.id === taskId) ?? steps[0], [steps, taskId]);

  useEffect(() => {
    if (!step || startedSteps.current.has(step.id)) return;
    startedSteps.current.add(step.id);
    void postJson("/api/candidate/event", { kind: "started_step", stepId: step.id }).catch(() => {});
  }, [step]);

  function openMessage(id: string) {
    setDrawer({ open: true, messageId: id });
    if (toastId === id) setToastId(null);
    if (!opened.has(id)) {
      setOpened((prev) => new Set(prev).add(id));
      // keepalive: the event (which is what keeps it read after a reload) still lands if the page unloads now.
      void postJson("/api/candidate/event", { kind: "opened_message", messageId: id }, { keepalive: true }).catch(() => {});
    }
  }

  function goToTask(id: string) {
    setTaskId(id);
    setDrawer((d) => ({ ...d, open: false }));
  }

  const saveStep = useCallback(
    async (stepId: string, answer: unknown) => {
      try {
        const res = await postJson("/api/candidate/answer", { stepId, answer });
        if (res.status === 409) return goDone();
        if (res.status === 401) return router.replace(`/a/${token}`);
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        failed.current.delete(stepId);
        setSaveState(saveTimers.current.size ? "saving" : failed.current.size ? "error" : "saved");
      } catch {
        failed.current.set(stepId, answer);
        setSaveState("error");
      }
    },
    [goDone, router, token],
  );

  function changeAnswer(stepId: string, answer: unknown) {
    setAnswers((prev) => ({ ...prev, [stepId]: answer }));
    setSaveState("saving");
    failed.current.delete(stepId);
    const timers = saveTimers.current;
    clearTimeout(timers.get(stepId));
    timers.set(
      stepId,
      setTimeout(() => {
        timers.delete(stepId);
        void saveStep(stepId, answer);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  const retrySaves = useCallback(() => {
    if (!failed.current.size) return;
    setSaveState("saving");
    for (const [stepId, answer] of [...failed.current]) void saveStep(stepId, answer);
  }, [saveStep]);

  // Keep retrying failed saves in the background while there are any.
  useEffect(() => {
    if (saveState !== "error") return;
    const timer = setInterval(retrySaves, RETRY_MS);
    return () => clearInterval(timer);
  }, [retrySaves, saveState]);

  const unread = messages.filter((m) => !opened.has(m.id)).length;
  const workbook = steps.filter((s) => isWorkbookStep(s.type));
  const index = step ? steps.indexOf(step) : -1;
  // The message that asked for this task; tasks without one point at the first message.
  const request = step ? (messages.find((m) => m.stepId === step.id) ?? messages[messages.length - 1]) : undefined;
  const updates = messages.filter((m) => m.arriveAtMinute > 0 && !m.stepId && m.id !== request?.id);
  const toast = toastId ? messages.find((m) => m.id === toastId) : undefined;
  const brief = step ? stepBrief(step) : null;
  const showOneMinute = remaining > 0 && remaining <= ONE_MINUTE_MS && !oneMinuteDismissed;

  const arrival = (m: PublicMessage, short = false) =>
    startedAt ? (
      <ClockTime iso={new Date(new Date(startedAt).getTime() + m.arriveAtMinute * 60_000).toISOString()} short={short} />
    ) : m.arriveAtMinute === 0 ? (
      "At start"
    ) : (
      `${m.arriveAtMinute} min in`
    );

  const messageCard = (m: PublicMessage, extraClass = "") => {
    const { name } = senderParts(m.from);
    const isUnread = !opened.has(m.id);
    return (
      <button
        type="button"
        key={m.id}
        className={`cardbtn msgcard${isUnread && m.arriveAtMinute > 0 ? " new" : ""}${extraClass}`}
        onClick={() => openMessage(m.id)}
      >
        <Avatar name={name} size={26} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="row g6" style={{ fontSize: 13, fontWeight: isUnread ? 600 : 500 }}>
            {isUnread && m.arriveAtMinute > 0 ? <span className="dot accentc" aria-label="unread" /> : null}
            {name} · {arrival(m)}
          </span>
          <span className="xs muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {m.subject}
          </span>
        </span>
      </button>
    );
  };

  const calcButton = (
    <button type="button" className="btn btn-sm" aria-pressed={calcOpen} onClick={() => setCalcOpen((o) => !o)}>
      <Icon name="calc" />
      Calculator
    </button>
  );

  let main: ReactNode = null;
  if (step) {
    const view = (
      <StepView key={step.id} step={step} answer={answers[step.id]} onChange={(a) => changeAnswer(step.id, a)} />
    );
    if (isWorkbookStep(step.type)) {
      main = (
        <>
          <div className="wtabs">
            {/* Only the tabs are in the tablist; the calculator button sits beside it. */}
            <div role="tablist" aria-label="Workbook" style={{ display: "contents" }}>
            {workbook.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === step.id}
                className={s.id === step.id ? "wtab on" : "wtab"}
                onClick={() => setTaskId(s.id)}
              >
                {shortLabel(s.title)}
              </button>
            ))}
            </div>
            <span className="grow" />
            <span style={{ marginBottom: 6 }}>{calcButton}</span>
          </div>
          {view}
        </>
      );
    } else if (step.type === "inbox_reply") {
      const to = request ? senderParts(request.from).name : null;
      main = (
        <div className="replywrap">
          <div className="row g10 wrap">
            <span className="row g8">
              <Icon name="reply" />
              <span className="strong">{to ? `Reply to ${to}` : shortLabel(step.title)}</span>
            </span>
            {request ? <span className="small muted">Re: {request.subject}</span> : null}
            <span className="grow" />
            {workbook.length ? (
              <button type="button" className="btn btn-sm" onClick={() => setTaskId(workbook[0].id)}>
                <Icon name="grid" />
                Open workbook
              </button>
            ) : null}
          </div>
          {view}
          {request ? (
            <details className="card" style={{ padding: "12px 16px" }}>
              <summary className="small" style={{ cursor: "pointer" }}>
                <span className="strong">{to}&apos;s request</span> <span className="muted">· {arrival(request)}</span>
              </summary>
              <p className="small ink2 pre" style={{ marginTop: 10, lineHeight: 1.6 }}>
                {request.body}
              </p>
            </details>
          ) : null}
        </div>
      );
    } else if (step.type === "numeric") {
      main = (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "40px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
          {view}
          <div className="row g10">{calcButton}</div>
        </div>
      );
    } else if (step.type === "document_review") {
      main = view;
    } else {
      main = <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 24 }}>{view}</div>;
    }
  }

  const saveIndicator =
    saveState === "saving" ? (
      <span className="xs saveind busy">
        <span className="spin" style={{ width: 11, height: 11 }} />
        Saving…
      </span>
    ) : saveState === "error" ? (
      <span className="xs saveind" style={{ color: "var(--bad)" }}>
        <Icon name="alert" className="i-sm" />
        Couldn&apos;t save
      </span>
    ) : (
      <span className="xs saveind ok">
        <Icon name="check" className="i-sm" />
        Saved
      </span>
    );

  const drawerMessage = drawer.messageId ? messages.find((m) => m.id === drawer.messageId) : undefined;

  return (
    <Proctoring settings={proctoring} inlineIndicators>
      <div className="ws">
        <header className="ws-head">
          <TimerBadge remainingMs={remaining} />
          <div className="col ws-title" style={{ lineHeight: 1.2, minWidth: 0 }}>
            <span className="strong" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
              {initial.title}
            </span>
            {companyName ? <span className="xs muted">{companyName}</span> : null}
          </div>
          <span className="grow" />
          {steps.length ? (
            <nav className="tasknav" aria-label="Tasks">
              {steps.map((s, i) => {
                const on = s.id === step?.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={on ? "on" : undefined}
                    aria-current={on ? "step" : undefined}
                    title={`${s.title}${hasAnswer(answers[s.id]) ? " — started" : ""}`}
                    onClick={() => setTaskId(s.id)}
                  >
                    <span className="n">{i + 1}</span>
                    <span className="lbl">{shortLabel(s.title)}</span>
                  </button>
                );
              })}
            </nav>
          ) : null}
          <span className="grow" />
          <FullscreenButton />
          <button
            type="button"
            className="btn btn-sm"
            aria-expanded={drawer.open}
            onClick={() => setDrawer((d) => ({ open: !d.open, messageId: null }))}
          >
            <Icon name="mail" />
            Inbox
            {unread ? (
              <>
                {" "}
                <span className="count count-accent">{unread}</span>
                {" "}
                <span className="sr">unread</span>
              </>
            ) : null}
          </button>
          <div className="row g6" style={{ paddingLeft: 12, borderLeft: "1px solid var(--line)" }}>
            <ProctoringIndicators />
            <span aria-live="polite" data-testid="save-status">
              {saveIndicator}
            </span>
          </div>
          <Link href={`/a/${token}/review`} className="btn btn-dark">
            Submit
          </Link>
        </header>

        {saveState === "error" ? (
          <div className="wsbanner" role="alert" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "var(--bad-line)" }}>
            <Icon name="alert" />
            <span className="txt">
              <strong>Your last change didn&apos;t save.</strong> Check your connection — we&apos;ll keep retrying, and nothing
              you&apos;ve typed is lost on this page.
            </span>
            <span className="grow" />
            <button type="button" className="btn btn-sm" onClick={retrySaves}>
              Retry now
            </button>
          </div>
        ) : null}
        {showOneMinute ? (
          <div className="wsbanner warn" role="status">
            <Icon name="clock" />
            <span className="txt">
              <strong>1 minute left.</strong> At 0:00, everything that&apos;s saved is submitted automatically.
            </span>
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOneMinuteDismissed(true)} aria-label="Dismiss">
              <Icon name="x" className="i-sm" />
            </button>
          </div>
        ) : null}

        <div className="ws-body">
          <aside className="brief" aria-label="Task details">
            {step ? (
              <div className="sec" style={{ padding: "20px 20px 16px" }}>
                <span className="eyebrow">
                  Task {index + 1} of {steps.length}
                </span>
                <h1 style={{ fontSize: 22 }}>{step.title}</h1>
                {brief ? <p className="ink2 pre">{brief}</p> : null}
              </div>
            ) : (
              <div className="sec" style={{ padding: "20px 20px 16px" }}>
                <h1 style={{ fontSize: 22 }}>{initial.title}</h1>
                <p className="ink2 pre">{initial.intro}</p>
              </div>
            )}
            {request || updates.length ? (
              <>
                <div className="divider" />
                <div className="sec">
                  <span className="eyebrow">Requested in</span>
                  {request ? messageCard(request) : null}
                  {updates.map((m) => messageCard(m))}
                </div>
              </>
            ) : null}
            <span className="grow" />
            <div style={{ padding: "14px 20px", background: "var(--subtle)", borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 8 }}>
              <Icon name="info" className="i-sm" />
              <span>
                {step?.type === "document_review"
                  ? "Flags on items that are fine cost points. Flag only real issues."
                  : "Move between tasks freely. Everything saves automatically."}
              </span>
            </div>
          </aside>

          <main className="ws-main">
            {main}

            {toast ? (
              <div className="toast" role="status" aria-live="polite">
                <span className="ovicon" style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", flex: "none" }}>
                  <Icon name="mail" />
                </span>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span className="xs muted">New email · {arrival(toast)}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {senderParts(toast.from).name}: {toast.subject}
                  </span>
                  <div className="row g8" style={{ marginTop: 6 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => openMessage(toast.id)}>
                      Read now
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setToastId(null)}>
                      Later
                    </button>
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} onClick={() => setToastId(null)} aria-label="Dismiss">
                  <Icon name="x" className="i-sm" />
                </button>
              </div>
            ) : null}

            {drawer.open ? (
              <aside className="drawer" role="dialog" aria-label="Inbox">
                <div className="drawer-head">
                  {drawerMessage ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawer({ open: true, messageId: null })}>
                      <Icon name="chevL" />
                      Inbox
                    </button>
                  ) : (
                    <>
                      <h2 className="strong" style={{ fontFamily: "var(--font)", fontSize: 15, letterSpacing: 0 }}>
                        Inbox
                      </h2>
                      {unread ? <span className="count count-accent">{unread} new</span> : null}
                    </>
                  )}
                  <span className="grow" />
                  <button type="button" className="btn btn-ghost btn-icon" onClick={() => setDrawer({ open: false, messageId: null })} aria-label="Close inbox">
                    <Icon name="x" />
                  </button>
                </div>
                <div className="drawer-body">
                  {drawerMessage ? (
                    <MessageView
                      message={drawerMessage}
                      time={arrival(drawerMessage)}
                      task={drawerMessage.stepId ? steps.find((s) => s.id === drawerMessage.stepId) : undefined}
                      onTask={goToTask}
                    />
                  ) : (
                    <ul role="list" aria-label="Messages" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                      {messages.map((m) => {
                        const isUnread = !opened.has(m.id);
                        const { name } = senderParts(m.from);
                        return (
                          <li key={m.id}>
                            <button type="button" className={`cardbtn inboxrow${isUnread ? " unread" : ""}`} onClick={() => openMessage(m.id)}>
                              <span className="row g6">
                                {isUnread ? <span className="dot accentc" aria-label="unread" /> : null}
                                <span style={{ fontWeight: isUnread ? 600 : 500, fontSize: 13 }}>{name}</span>
                                <span className="xs muted" style={{ marginLeft: "auto" }}>
                                  {arrival(m, true)}
                                </span>
                              </span>
                              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{m.subject}</span>
                              <span className="xs muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {m.body}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </aside>
            ) : null}

            {calcOpen ? <Calculator onClose={() => setCalcOpen(false)} /> : null}
          </main>
        </div>
      </div>
    </Proctoring>
  );
}

function MessageView({
  message,
  time,
  task,
  onTask,
}: {
  message: PublicMessage;
  time: ReactNode;
  task?: PublicStep;
  onTask(id: string): void;
}) {
  const { name, role } = senderParts(message.from);
  return (
    <article className="col g10" aria-label={message.subject}>
      <h3 style={{ fontFamily: "var(--font)", fontSize: 17, letterSpacing: 0, fontWeight: 600 }}>{message.subject}</h3>
      <div className="row g8 small">
        <Avatar name={name} size={24} />
        <span className="strong">{name}</span>
        <span className="muted">· {time}</span>
      </div>
      {role ? <span className="xs muted">{role}</span> : null}
      <p className="pre" style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", marginTop: 4 }}>
        {message.body}
      </p>
      {task ? (
        <div className="row g8" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => onTask(task.id)}>
            <Icon name={task.type === "inbox_reply" ? "reply" : "arrowR"} />
            {task.type === "inbox_reply" ? "Reply" : `Go to ${shortLabel(task.title).toLowerCase()}`}
          </button>
        </div>
      ) : null}
    </article>
  );
}
