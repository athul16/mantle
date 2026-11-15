"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Button, FormMessage } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { AssessmentSummary } from "@/lib/jobs/queries";
import { isMonitored } from "@/lib/proctoring/config";
import { cloneAssessment, createAssessment, updateAssessment } from "../actions";

/** Lengths offered in the time-limit menu, plus the recommended and current ones. */
const LENGTHS = [10, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120];

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="co-err">
      <Icon name="alert" className="i-sm" />
      {text}
    </p>
  );
}

/** One labelled row of the settings card: title + hint on the left, controls on the right. */
function SettingRow({ title, hint, children, last = false }: { title: string; hint: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr)",
        gap: 24,
        padding: "20px 24px",
        borderBottom: last ? undefined : "1px solid var(--line)",
      }}
    >
      <div>
        <div className="strong">{title}</div>
        <div className="small muted">{hint}</div>
      </div>
      {children}
    </div>
  );
}

type Monitoring = "monitored" | "not_monitored";

/** One Monitored / Not monitored radio with its one-line explanation (outside the label, so not part of its name). */
function MonitoringChoice({
  value,
  label,
  help,
  checked,
  onChange,
}: {
  value: Monitoring;
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: Monitoring) => void;
}) {
  const id = `ca-mon-${value}`;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <input
        type="radio"
        id={id}
        name="monitoring"
        value={value}
        required
        checked={checked}
        onChange={() => onChange(value)}
        aria-describedby={`${id}-help`}
        style={{ marginTop: 3, accentColor: "var(--ink)" }}
      />
      <div>
        <label htmlFor={id} className="small strong">
          {label}
        </label>
        <div id={`${id}-help`} className="xs muted">
          {help}
        </div>
      </div>
    </div>
  );
}

/** An on/off switch (.toggle) that submits "on" under `name` when on. */
function Toggle({ name, label, on, onChange, disabled }: { name?: string; label: string; on: boolean; onChange?: (on: boolean) => void; disabled?: boolean }) {
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={on ? "toggle on" : "toggle"}
        disabled={disabled}
        onClick={() => onChange?.(!on)}
      />
      {name && on ? <input type="hidden" name={name} value="on" /> : null}
    </>
  );
}

const FORM_ID = "configure-assessment";

type Mode =
  | { kind: "create"; scenarioId: string; recommendedMinutes: number; defaultTitle?: string }
  | { kind: "edit"; assessment: AssessmentSummary; recommendedMinutes: number };

/**
 * The Configure assessment screen's form (prototype k3-configure-a). Creating
 * from the library saves and opens the Create job dialog with this assessment;
 * editing saves in place. A locked assessment shows its settings read-only.
 */
export function ConfigureAssessmentForm({
  orgId,
  mode,
  cancelHref,
  jobsBase,
  readOnly = false,
}: {
  orgId: string;
  mode: Mode;
  cancelHref: string;
  jobsBase: string;
  /** Viewers see the settings but can't change or clone them. */
  readOnly?: boolean;
}) {
  const editing = mode.kind === "edit" ? mode.assessment : null;
  const locked = Boolean(editing?.lockedAt) || readOnly;
  const [createState, createAction, creating] = useActionState(createAssessment, undefined);
  const [updateState, updateAction, saving] = useActionState(updateAssessment, undefined);
  const state = editing ? updateState : createState;
  const pending = editing ? saving : creating;
  const router = useRouter();
  // D5: a new assessment needs an explicit Monitored / Not monitored choice, with nothing preselected.
  const [monitoring, setMonitoring] = useState<Monitoring | null>(
    editing ? (isMonitored(editing.proctoring) ? "monitored" : "not_monitored") : null,
  );
  const [camera, setCamera] = useState(editing ? editing.proctoring.camera : false);
  const [screenShare, setScreenShare] = useState(editing ? editing.proctoring.screen : false);
  const [fullscreen, setFullscreen] = useState(editing ? editing.proctoring.fullscreen : false);
  const [microphone, setMicrophone] = useState(editing ? editing.proctoring.microphone : false);
  const [gazeChoice, setGazeChoice] = useState(editing ? editing.proctoring.gaze : false);
  // Gaze needs the camera: it reads as off, and isn't sent, while the camera is off.
  const gaze = camera && gazeChoice;
  const errors = state?.fieldErrors;
  const created = !editing ? createState?.id : undefined;

  useEffect(() => {
    if (created) router.push(`${jobsBase}?create=1&assessment=${created}`);
  }, [created, jobsBase, router]);

  const current = editing?.timeLimitMinutes ?? mode.recommendedMinutes;
  const lengths = [...new Set([...LENGTHS, mode.recommendedMinutes, current])].sort((a, b) => a - b);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <form id={FORM_ID} action={editing ? updateAction : createAction} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <input type="hidden" name="orgId" value={orgId} />
      {editing ? <input type="hidden" name="assessmentId" value={editing.id} /> : <input type="hidden" name="scenarioId" value={mode.kind === "create" ? mode.scenarioId : ""} />}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <section className="card" style={{ overflow: "hidden" }}>
          <SettingRow title="Name" hint="Only your team sees this">
            <div>
              <input
                className={`input${errors?.title ? " invalid" : ""}`}
                name="title"
                required
                defaultValue={editing ? editing.title : mode.kind === "create" ? mode.defaultTitle : undefined}
                placeholder="Staff Accountant Intern — Spring 2027"
                aria-label="Assessment name"
                aria-invalid={errors?.title ? true : undefined}
                aria-describedby={errors?.title ? "ca-title-err" : undefined}
              />
              <FieldError id="ca-title-err" text={errors?.title?.[0]} />
            </div>
          </SettingRow>
          <SettingRow title="Time limit" hint={`Designed for ${mode.recommendedMinutes} minutes`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <select
                className="select"
                style={{ width: 220 }}
                name="timeLimitMinutes"
                defaultValue={current}
                aria-label="Time limit"
                aria-describedby={errors?.timeLimitMinutes ? "ca-time-err" : undefined}
              >
                {lengths.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes{m === mode.recommendedMinutes ? " (recommended)" : ""}
                  </option>
                ))}
              </select>
              <FieldError id="ca-time-err" text={errors?.timeLimitMinutes?.[0]} />
            </div>
          </SettingRow>
          <SettingRow title="Pass score" hint="A label, never an automatic rejection">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  className={`input tnum${errors?.passScore ? " invalid" : ""}`}
                  style={{ width: 90 }}
                  name="passScore"
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  placeholder="None"
                  defaultValue={editing?.passScore ?? undefined}
                  aria-label="Pass score"
                  aria-invalid={errors?.passScore ? true : undefined}
                  aria-describedby={errors?.passScore ? "ca-pass-hint ca-pass-err" : "ca-pass-hint"}
                />
                <span id="ca-pass-hint" className="small muted">
                  out of 100 · candidates at or above get a “Meets bar” label
                </span>
              </div>
              <FieldError id="ca-pass-err" text={errors?.passScore?.[0]} />
            </div>
          </SettingRow>
          <SettingRow title="Monitoring" hint="Candidates see exactly this list before they agree" last>
            <fieldset
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}
              aria-describedby={errors?.monitoring ? "ca-mon-err" : undefined}
              aria-invalid={errors?.monitoring ? true : undefined}
            >
              <legend className="sr-only">Proctoring</legend>
              <MonitoringChoice
                value="monitored"
                label="Monitored"
                help="Candidates agree to camera photos and/or screen screenshots while they work."
                checked={monitoring === "monitored"}
                onChange={setMonitoring}
              />
              {monitoring === "monitored" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 26 }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Toggle name="camera" label="Camera snapshots" on={camera} onChange={setCamera} disabled={locked} />
                    <div>
                      <div className="small strong">Camera snapshots</div>
                      <div className="xs muted">Occasional photos of the candidate while they work</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Toggle name="screen" label="Entire-screen sharing" on={screenShare} onChange={setScreenShare} disabled={locked} />
                    <div>
                      <div className="small strong">Entire-screen sharing</div>
                      <div className="xs muted">The workspace locks if sharing stops, until it&apos;s restored</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Toggle name="fullscreen" label="Require full screen" on={fullscreen} onChange={setFullscreen} disabled={locked} />
                    <div>
                      <div className="small strong">Require full screen</div>
                      <div className="xs muted">The task runs full screen; leaving it covers the task while the timer keeps running</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Toggle name="microphone" label="Microphone (audio clips when speech is heard)" on={microphone} onChange={setMicrophone} disabled={locked} />
                    <div>
                      <div className="small strong">Microphone (audio clips when speech is heard)</div>
                      <div className="xs muted">Short clips are saved only when speech is heard</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Toggle
                      name="gaze"
                      label="Gaze check (on-device: facing the screen, number of faces)"
                      on={gaze}
                      onChange={setGazeChoice}
                      disabled={locked || !camera}
                    />
                    <div>
                      <div className="small strong">Gaze check (on-device: facing the screen, number of faces)</div>
                      <div className="xs muted">Needs the camera; only the result is sent, never the image</div>
                    </div>
                  </div>
                </div>
              ) : null}
              <MonitoringChoice
                value="not_monitored"
                label="Not monitored"
                help="No camera or screen capture. Leaving the window and copy/paste are still noted."
                checked={monitoring === "not_monitored"}
                onChange={setMonitoring}
              />
              <div style={{ display: "flex", gap: 12 }}>
                <Toggle label="Activity log (always on)" on disabled />
                <div>
                  <div className="small strong">Activity log</div>
                  <div className="xs muted">Timestamped opens, edits and sends · always on</div>
                </div>
              </div>
              <FieldError id="ca-mon-err" text={errors?.monitoring?.[0]} />
            </fieldset>
          </SettingRow>
        </section>
      </fieldset>
      {state?.error || (editing && state?.message) ? <FormMessage error={state?.error} message={editing ? state?.message : undefined} /> : null}
    </form>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "flex-start" }}>
        <Link href={cancelHref} className="btn">
          {locked ? "Back" : "Cancel"}
        </Link>
        {editing ? (
          <>
            {readOnly ? null : <CloneAssessmentButton orgId={orgId} assessmentId={editing.id} primary={locked} />}
            {locked ? null : (
              <Button type="submit" form={FORM_ID} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            )}
          </>
        ) : (
          <Button type="submit" form={FORM_ID} disabled={pending || Boolean(created)}>
            {pending || created ? "Saving…" : "Save and attach to a job"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Copies an assessment's settings into a new, unlocked one. */
export function CloneAssessmentButton({ orgId, assessmentId, primary = false, small = false }: { orgId: string; assessmentId: string; primary?: boolean; small?: boolean }) {
  const [state, action, pending] = useActionState(cloneAssessment, undefined);
  return (
    <form action={action} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <Button type="submit" variant={primary ? "primary" : "secondary"} size={small ? "sm" : "md"} disabled={pending}>
        {pending ? "Cloning…" : "Clone"}
      </Button>
      {state?.error ? <span className="xs badc">{state.error}</span> : null}
      {state?.message ? <span className="xs okc">{state.message}</span> : null}
    </form>
  );
}
