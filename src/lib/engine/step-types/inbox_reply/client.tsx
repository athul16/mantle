"use client";

import { useId } from "react";
import type { StepComponentProps } from "../../types";
import type { InboxReplyAnswer, InboxReplyPublicConfig } from "./public";

const countWords = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

/** Browser half of the `inbox_reply` step type: an email reply editor. */
export function InboxReplyStep({
  config,
  answer,
  onChange,
  disabled,
}: StepComponentProps<InboxReplyPublicConfig, InboxReplyAnswer>) {
  const bodyId = useId();
  const body = answer?.body ?? "";

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 whitespace-pre-line">{config.prompt}</p>
      <div className="rounded border border-neutral-300 dark:border-neutral-700">
        {config.to || config.subject ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
            {config.to ? (
              <>
                <dt className="text-neutral-500">To</dt>
                <dd className="truncate">{config.to}</dd>
              </>
            ) : null}
            {config.subject ? (
              <>
                <dt className="text-neutral-500">Subject</dt>
                <dd className="truncate">{config.subject}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <label htmlFor={bodyId} className="sr-only">
          Reply
        </label>
        <textarea
          id={bodyId}
          rows={10}
          disabled={disabled}
          maxLength={config.maxChars}
          value={body}
          placeholder="Write your reply…"
          onChange={(e) => onChange({ body: e.target.value.slice(0, config.maxChars) })}
          className="block w-full resize-y bg-transparent px-3 py-2 text-sm leading-6 outline-none"
        />
      </div>
      <p className="text-xs text-neutral-500">
        {countWords(body)} words · {body.length.toLocaleString("en-US")} / {config.maxChars.toLocaleString("en-US")}{" "}
        characters
      </p>
    </div>
  );
}
