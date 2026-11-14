"use client";

import { useId } from "react";
import type { StepComponentProps } from "../../types";
import type { InboxReplyAnswer, InboxReplyPublicConfig } from "./public";

const countWords = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

/**
 * Browser half of the `inbox_reply` step type: an email composer. The draft
 * is the answer; it's saved as the candidate types and submitted with the
 * attempt (there is no separate Send). The prompt is shown by the page (the
 * workspace's brief column).
 */
export function InboxReplyStep({
  config,
  answer,
  onChange,
  disabled,
}: StepComponentProps<InboxReplyPublicConfig, InboxReplyAnswer>) {
  const bodyId = useId();
  const body = answer?.body ?? "";

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {config.to ? (
        <div className="row g8" style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <span className="muted" style={{ width: 56, flex: "none" }}>
            To
          </span>
          <span className="badge b-plain">{config.to}</span>
        </div>
      ) : null}
      {config.subject ? (
        <div className="row g8" style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <span className="muted" style={{ width: 56, flex: "none" }}>
            Subject
          </span>
          <span>{config.subject}</span>
        </div>
      ) : null}
      <label htmlFor={bodyId} className="sr">
        Reply
      </label>
      <textarea
        id={bodyId}
        disabled={disabled}
        maxLength={config.maxChars}
        value={body}
        placeholder="Write your reply"
        onChange={(e) => onChange({ body: e.target.value.slice(0, config.maxChars) })}
        className="textarea"
        style={{ border: 0, borderRadius: 0, minHeight: 220, resize: "vertical" }}
      />
      <div className="row g10" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)", background: "var(--subtle)" }}>
        <span className="xs muted">Draft saves as you type and is submitted with your work.</span>
        <span className="grow" />
        <span className="xs muted tnum">
          {countWords(body)} words · {body.length.toLocaleString("en-US")} / {config.maxChars.toLocaleString("en-US")} characters
        </span>
      </div>
    </div>
  );
}
