/**
 * Reads emails the app wrote to `.dev-outbox/` (sendEmail's fallback when
 * RESEND_API_KEY is not set). File names are `<iso-timestamp>-<to>.json` with
 * every character outside [a-zA-Z0-9._-] replaced by `_`, so they sort by time.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

export const OUTBOX_DIR = path.join(process.cwd(), ".dev-outbox");

export type OutboxEmail = { file: string; sentAt: string; from: string; to: string; subject: string; text: string; html?: string };

const safeAddress = (email: string) => email.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

/** All emails sent to `email`, oldest first. */
export async function emailsTo(email: string, dir = OUTBOX_DIR): Promise<OutboxEmail[]> {
  const suffix = `-${safeAddress(email)}.json`;
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(suffix)).sort();
  const out: OutboxEmail[] = [];
  for (const file of files) {
    const msg = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    if (msg.to === email) out.push({ file, ...msg });
  }
  return out;
}

/** The newest email to `email`, or undefined. */
export async function latestEmail(email: string, dir = OUTBOX_DIR): Promise<OutboxEmail | undefined> {
  return (await emailsTo(email, dir)).at(-1);
}

/** Polls until an email to `email` arrives (optionally newer than `after`, an ISO time). */
export async function waitForEmail(
  email: string,
  { after, timeoutMs = 15_000, dir = OUTBOX_DIR }: { after?: string; timeoutMs?: number; dir?: string } = {},
): Promise<OutboxEmail> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const mail = await latestEmail(email, dir);
    if (mail && (!after || mail.sentAt > after)) return mail;
    if (Date.now() > until) throw new Error(`no email to ${email} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The invite token from an invite email's `/a/<token>` link. */
export function inviteTokenFrom(mail: Pick<OutboxEmail, "text">): string {
  const match = mail.text.match(/\/a\/([A-Za-z0-9_-]{20,})/);
  if (!match) throw new Error("no /a/<token> link in email");
  return match[1];
}

/** The 6-digit code from a verification email. */
export function codeFrom(mail: Pick<OutboxEmail, "text">): string {
  const match = /\b(\d{6})\b/.exec(mail.text);
  if (!match) throw new Error("no 6-digit code in email");
  return match[1];
}

/** Deletes every outbox email sent to any of `emails`. */
export async function clearEmails(emails: string[], dir = OUTBOX_DIR): Promise<void> {
  const suffixes = emails.map((e) => `-${safeAddress(e)}.json`);
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => suffixes.some((s) => f.endsWith(s))).map((f) => rm(path.join(dir, f), { force: true })));
}
