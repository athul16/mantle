"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, FormMessage } from "@/components/ui";
import { Icon } from "@/components/icons";
import { parseCsvEmails, parsePastedEmails } from "@/lib/jobs/emails";
import { LocalDate } from "../../local-date";
import { inviteCandidates } from "../../actions";

const SEPARATOR = /[\s,;]+/;

type ChipKind = "ready" | "bad" | "already";

function chipKind(raw: string, already: Set<string>): ChipKind {
  const parsed = parsePastedEmails(raw);
  if (parsed.recipients.length !== 1) return "bad";
  return already.has(parsed.recipients[0].email) ? "already" : "ready";
}

/** Splits text into chips, keeping the first spelling of each address. */
function addChips(chips: string[], text: string): string[] {
  const seen = new Set(chips.map((c) => c.toLowerCase()));
  const out = [...chips];
  for (const piece of text.split(SEPARATOR)) {
    const p = piece.trim();
    if (!p || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    out.push(p);
  }
  return out;
}

/** Summary card facts (right column). */
export type InviteSummary = { assessment: string; minutes: number | null; deadline: string | null };

/**
 * Invite candidates (prototype k5-invite-a): emails as chips (ready, needs a
 * fix, already invited) or a CSV, a preview of the email, and a summary card
 * with the send button. The server re-checks everything (inviteCandidates).
 */
export function InviteCandidatesForm({
  orgId,
  jobId,
  max,
  existingEmails = [],
  summary,
  emailPreview,
  jobHref,
}: {
  orgId: string;
  jobId: string;
  max: number;
  /** Emails already invited to this job, lowercased: shown greyed and skipped. */
  existingEmails?: string[];
  summary?: InviteSummary;
  emailPreview?: { subject: string; body: string };
  /** The job's candidate list, linked after a successful send. */
  jobHref?: string;
}) {
  const [state, action, pending] = useActionState(inviteCandidates, undefined);
  const [tab, setTab] = useState<"paste" | "csv">("paste");
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [csv, setCsv] = useState<{ name: string; emails: string[]; invalid: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const already = useMemo(() => new Set(existingEmails.map((e) => e.toLowerCase())), [existingEmails]);

  // After a send: a rejected batch comes back with its text, so put it back as
  // chips; an accepted one clears the box and the file. (Adjusted during
  // render when the result changes, not in an effect.)
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.emails !== undefined) {
      setChips(addChips([], state.emails));
      setText("");
    } else if (state?.message) {
      setChips([]);
      setText("");
      setCsv(null);
    }
  }
  const accepted = state?.emails === undefined && Boolean(state?.message);
  useEffect(() => {
    // The chosen file lives in the DOM input; clear it too.
    if (accepted && fileRef.current) fileRef.current.value = "";
  }, [accepted, state]);

  const kinds = chips.map((c) => chipKind(c, already));
  const pendingText = text.trim();
  const pendingKind = pendingText ? chipKind(pendingText, already) : null;
  const pasteReady = new Set(chips.filter((_, i) => kinds[i] === "ready").map((c) => c.toLowerCase()));
  if (pendingKind === "ready") pasteReady.add(pendingText.toLowerCase());
  const toFix = kinds.filter((k) => k === "bad").length + (pendingKind === "bad" ? 1 : 0);
  const skipped = kinds.filter((k) => k === "already").length + (pendingKind === "already" ? 1 : 0);
  const csvReady = (csv?.emails ?? []).filter((e) => !already.has(e) && !pasteReady.has(e));
  const sending = pasteReady.size + csvReady.length;

  const onType = (value: string) => {
    if (SEPARATOR.test(value)) {
      const parts = value.split(SEPARATOR);
      const rest = /[\s,;]$/.test(value) ? "" : (parts.pop() ?? "");
      setChips((c) => addChips(c, parts.join("\n")));
      setText(rest);
    } else {
      setText(value);
    }
  };
  const commit = () => {
    if (!text.trim()) return;
    setChips((c) => addChips(c, text));
    setText("");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return setCsv(null);
    const parsed = parseCsvEmails(await file.text());
    setCsv({ name: file.name, emails: parsed.recipients.map((r) => r.email), invalid: parsed.invalid.length });
  };

  const tabButton = (id: "paste" | "csv", icon: "mail" | "upload", label: string) => (
    <button
      type="button"
      role="tab"
      id={`invite-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`invite-panel-${id}`}
      className={tab === id ? "tab on" : "tab"}
      onClick={() => setTab(id)}
    >
      <Icon name={icon} />
      {label}
    </button>
  );

  return (
    <form action={action} style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="emails" value={[...chips, text].filter((s) => s.trim()).join("\n")} />

      <section className="card" style={{ flex: "999 1 560px", minWidth: 0, overflow: "hidden" }}>
        <div className="tabs" role="tablist" aria-label="Invite method" style={{ padding: "0 16px" }}>
          {tabButton("paste", "mail", "Paste emails")}
          {tabButton("csv", "upload", "Upload CSV")}
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <InviteResult state={state} jobHref={jobHref} />

          <div id="invite-panel-paste" role="tabpanel" aria-labelledby="invite-tab-paste" hidden={tab !== "paste"}>
            <label className="label" htmlFor="invite-emails">Email addresses</label>
            <div
              onClick={() => inputRef.current?.focus()}
              style={{
                minHeight: 110,
                border: "1px solid var(--line-2)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignContent: "flex-start",
                background: "#fff",
                cursor: "text",
              }}
              className="chipbox"
            >
              {chips.map((c, i) => (
                <Chip key={c} kind={kinds[i]} onRemove={() => setChips((all) => all.filter((x) => x !== c))}>
                  {c}
                </Chip>
              ))}
              {/* A one-row textarea, not an input: inputs drop the line breaks in a pasted list. */}
              <textarea
                ref={inputRef}
                id="invite-emails"
                rows={1}
                value={text}
                onChange={(e) => onType(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Backspace" && !text && chips.length) {
                    setChips((all) => all.slice(0, -1));
                  }
                }}
                onBlur={commit}
                style={{ border: 0, outline: 0, flex: 1, minWidth: 200, height: 26, padding: "3px 0", resize: "none", overflow: "hidden", font: "14px var(--font)", background: "transparent" }}
                placeholder="Paste or type, separated by commas or new lines"
                aria-describedby="invite-counts invite-limit"
              />
            </div>
            <p id="invite-counts" className="help" aria-live="polite">
              <span className="strong" style={{ color: "var(--ink)" }}>{pasteReady.size} ready</span>
              {toFix ? (
                <>
                  {" · "}
                  <span style={{ color: "var(--bad)" }}>{toFix} to fix</span>
                </>
              ) : null}
              {skipped ? ` · ${skipped} already invited, will be skipped` : null}
            </p>
            <p id="invite-limit" className="help">
              Up to {max} candidates per batch. Duplicates and people already invited to this job are skipped. If an email bounces, it&apos;s listed as
              not delivered so you can resend it.
            </p>
          </div>

          <div id="invite-panel-csv" role="tabpanel" aria-labelledby="invite-tab-csv" hidden={tab !== "csv"}>
            <label className="label" htmlFor="invite-csv">CSV file</label>
            <div
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px dashed var(--line-2)", borderRadius: 8, background: "#fff" }}
            >
              <Icon name="upload" className="muted" />
              <input
                ref={fileRef}
                id="invite-csv"
                type="file"
                name="csv"
                accept=".csv,text/csv,text/plain"
                className="small"
                onChange={(e) => void onFile(e.currentTarget.files?.[0])}
              />
            </div>
            <p className="help">
              Uses the &quot;email&quot; column (and &quot;name&quot; if present); without a header, the first cell with an @ in each row.
            </p>
            {csv ? (
              <p className="help" aria-live="polite">
                <span className="strong" style={{ color: "var(--ink)" }}>
                  {csv.name}: {csvReady.length} ready
                </span>
                {csv.invalid ? (
                  <>
                    {" · "}
                    <span style={{ color: "var(--bad)" }}>{csv.invalid} to fix</span>
                  </>
                ) : null}
                {csv.emails.length - csvReady.length ? ` · ${csv.emails.length - csvReady.length} already listed or invited, will be skipped` : null}
              </p>
            ) : null}
          </div>

          {emailPreview ? (
            <>
              <div className="divider" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="strong small">Email candidates receive</span>
                <div
                  style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "14px 16px", background: "var(--subtle)", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}
                >
                  <span>
                    <span className="muted">Subject</span> {emailPreview.subject}
                  </span>
                  <span className="ink2">{emailPreview.body}</span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <aside className="card" style={{ flex: "1 1 280px", maxWidth: 340, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <span className="eyebrow">Summary</span>
        <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          {summary ? (
            <>
              <SummaryRow label="Assessment">{summary.assessment}</SummaryRow>
              {summary.minutes ? <SummaryRow label="Time limit">{summary.minutes} min</SummaryRow> : null}
              <SummaryRow label="Invites close">
                <LocalDate iso={summary.deadline} withTime />
              </SummaryRow>
            </>
          ) : null}
          <SummaryRow label="Sending to" strong>
            {sending} candidate{sending === 1 ? "" : "s"}
          </SummaryRow>
        </dl>
        <Button type="submit" size="lg" disabled={pending}>
          <Icon name="send" />
          {pending ? "Sending invites…" : sending > 0 ? `Send ${sending} invite${sending === 1 ? "" : "s"}` : "Send invites"}
        </Button>
        {toFix || csv?.invalid ? (
          <span className="xs" style={{ color: "var(--bad)" }}>Fix or remove the invalid address{toFix + (csv?.invalid ?? 0) === 1 ? "" : "es"} first. Nothing is sent while one is invalid.</span>
        ) : (
          <span className="xs muted">Each candidate gets their own link. People already invited are skipped.</span>
        )}
      </aside>
    </form>
  );
}

function SummaryRow({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0, textAlign: "right" }} className={strong ? "strong" : undefined}>
        {children}
      </dd>
    </div>
  );
}

function Chip({ kind, children, onRemove }: { kind: ChipKind; children: string; onRemove: () => void }) {
  if (kind === "already") {
    return (
      <span className="badge" style={{ height: 26, color: "var(--ink-3)" }}>
        {children} · already invited
        <ChipRemove label={children} onRemove={onRemove} />
      </span>
    );
  }
  return (
    <span className={kind === "bad" ? "badge b-bad" : "badge b-plain"} style={{ height: 26 }} title={kind === "bad" ? "Not a valid email address" : undefined}>
      {kind === "bad" ? <Icon name="alert" /> : null}
      {children}
      <ChipRemove label={children} onRemove={onRemove} />
    </span>
  );
}

function ChipRemove({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      style={{ all: "unset", cursor: "pointer", display: "inline-flex" }}
    >
      <Icon name="x" />
    </button>
  );
}

type InviteState = Awaited<ReturnType<typeof inviteCandidates>>;

/** The server's answer: summary, errors, invalid entries, undelivered emails. */
function InviteResult({ state, jobHref }: { state: InviteState; jobHref?: string }) {
  if (!state) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {state.message ? (
        <FormMessage
          message={state.message}
        />
      ) : null}
      {state.message && jobHref ? (
        <p className="small">
          <Link href={jobHref}>View candidates</Link>
        </p>
      ) : null}
      <FormMessage error={state.error} />
      {state.invalid?.length ? (
        <ul className="small" style={{ color: "var(--bad)", margin: 0 }}>
          {state.invalid.slice(0, 20).map((e, n) => (
            <li key={`${e}-${n}`}>{e}</li>
          ))}
          {state.invalid.length > 20 ? <li>…and {state.invalid.length - 20} more</li> : null}
        </ul>
      ) : null}
      {state.failedToSend?.length ? <p className="small badc">Not delivered: {state.failedToSend.join(", ")}</p> : null}
    </div>
  );
}

