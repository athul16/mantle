/**
 * `inbox_reply` step type, browser-safe part: what the candidate sees and what
 * they submit. The rubric (criteria, guidance, points) stays on the server, so
 * a candidate can't write to the marking scheme.
 */
import { z } from "zod";

export const INBOX_REPLY = "inbox_reply";

/** Hard cap on a reply, so autosave can't be used to stuff the database. */
export const INBOX_REPLY_MAX_CHARS = 20_000;

export interface InboxReplyPublicConfig {
  prompt: string;
  /** Who the reply goes to, e.g. "Marcus Lee <marcus@harborlane.example>". */
  to?: string;
  /** Subject line shown above the editor, e.g. "Re: Where did my money go?". */
  subject?: string;
  /** Character limit for this step (never above INBOX_REPLY_MAX_CHARS). */
  maxChars: number;
}

export const inboxReplyAnswerSchema = z
  .object({
    body: z.string().max(INBOX_REPLY_MAX_CHARS),
  })
  .strict();

export type InboxReplyAnswer = z.infer<typeof inboxReplyAnswerSchema>;
