import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { EnvError, emailEnvProblems, isDeployedEnv } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SentEmail {
  /** Resend message id, or the dev outbox file name. */
  id: string;
}

const DEFAULT_FROM = "Assessment Platform <no-reply@example.com>";
const OUTBOX_DIR = ".dev-outbox";

/**
 * Sends one email. With RESEND_API_KEY set it goes through Resend from
 * EMAIL_FROM; without it the message is written to .dev-outbox/ so local
 * development and tests work with no email provider.
 *
 * On a Vercel deployment (production or preview) there is no outbox: a missing
 * key or a missing/placeholder EMAIL_FROM throws an EnvError naming the
 * variables, before anything is sent. Throws if Resend rejects the message.
 */
export async function sendEmail(message: EmailMessage): Promise<SentEmail> {
  if (isDeployedEnv()) {
    const problems = emailEnvProblems();
    if (problems.length) throw new EnvError(problems, "App email is not configured; see docs/12-pilot-runbook.md.");
  }
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) return writeToOutbox(from, message);

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
  if (error || !data) {
    throw new Error(`email to ${message.to} failed: ${error?.message ?? "no response"}`);
  }
  return { id: data.id };
}

async function writeToOutbox(from: string, message: EmailMessage): Promise<SentEmail> {
  const sentAt = new Date().toISOString();
  const safeTo = message.to.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const file = `${sentAt.replace(/[:.]/g, "-")}-${safeTo}.json`;
  const dir = path.join(process.cwd(), OUTBOX_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, file),
    JSON.stringify({ sentAt, from, ...message }, null, 2),
  );
  console.log(`[email] RESEND_API_KEY not set; wrote "${message.subject}" to ${OUTBOX_DIR}/${file}`);
  return { id: file };
}
