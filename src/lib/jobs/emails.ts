import * as z from "zod";

/** Most candidates one invite batch may contain (after dedupe). */
export const MAX_INVITES_PER_BATCH = 200;

/** Largest CSV we read (well above 200 rows of email + name). */
export const MAX_CSV_BYTES = 256 * 1024;

export type ParsedRecipient = { email: string; name: string | null };

export type ParsedRecipients = {
  /** Valid, lowercased, first occurrence of each address, in input order. */
  recipients: ParsedRecipient[];
  /** Entries that aren't valid email addresses, as typed. */
  invalid: string[];
  /** Addresses that appeared more than once in the input (listed once). */
  duplicates: string[];
};

const emailSchema = z.email();

function isEmail(value: string) {
  return emailSchema.safeParse(value).success;
}

function collect(entries: ParsedRecipient[], invalidRaw: string[]): ParsedRecipients {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  const recipients: ParsedRecipient[] = [];
  for (const entry of entries) {
    if (seen.has(entry.email)) {
      dupes.add(entry.email);
      continue;
    }
    seen.add(entry.email);
    recipients.push(entry);
  }
  return { recipients, invalid: invalidRaw, duplicates: [...dupes] };
}

function clean(value: string) {
  return value.trim().replace(/^["'<]+|["'>]+$/g, "").trim();
}

/**
 * Emails pasted into a text box: separated by newlines, commas, semicolons,
 * spaces or tabs. Every non-empty piece must be an email.
 */
export function parsePastedEmails(text: string): ParsedRecipients {
  const valid: ParsedRecipient[] = [];
  const invalid: string[] = [];
  for (const piece of text.split(/[\s,;]+/)) {
    const raw = clean(piece);
    if (!raw) continue;
    const email = raw.toLowerCase();
    if (isEmail(email)) valid.push({ email, name: null });
    else invalid.push(raw);
  }
  return collect(valid, invalid);
}

/** Splits one CSV line, honouring double quotes ("a, b" stays one cell). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * A CSV export (from a spreadsheet or ATS). If the first row has a column
 * called "email" (and optionally "name"), those columns are used. Without a
 * header, each row's first cell containing "@" is the email. Rows with no
 * email-looking cell are skipped; cells that contain "@" but aren't valid
 * emails are reported as invalid.
 */
export function parseCsvEmails(csv: string): ParsedRecipients {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { recipients: [], invalid: [], duplicates: [] };

  const first = lines[0];
  const delimiter = [",", ";", "\t"].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ",");
  const header = splitCsvLine(first, delimiter).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const emailCol = header.findIndex((h) => h === "email" || h === "emailaddress" || h === "mail");
  const nameCol = header.findIndex((h) => h === "name" || h === "fullname" || h === "candidatename");
  const rows = emailCol >= 0 ? lines.slice(1) : lines;

  const valid: ParsedRecipient[] = [];
  const invalid: string[] = [];
  for (const line of rows) {
    const cells = splitCsvLine(line, delimiter);
    const rawCell = emailCol >= 0 ? cells[emailCol] ?? "" : cells.find((c) => c.includes("@")) ?? "";
    const raw = clean(rawCell);
    if (!raw) continue;
    const email = raw.toLowerCase();
    if (!isEmail(email)) {
      invalid.push(raw);
      continue;
    }
    const name = nameCol >= 0 ? clean(cells[nameCol] ?? "").slice(0, 200) || null : null;
    valid.push({ email, name });
  }
  return collect(valid, invalid);
}

/** Merges paste and CSV results, deduping across both. */
export function mergeRecipients(...parts: ParsedRecipients[]): ParsedRecipients {
  const entries = parts.flatMap((p) => p.recipients);
  const merged = collect(entries, parts.flatMap((p) => p.invalid));
  const dupes = new Set([...parts.flatMap((p) => p.duplicates), ...merged.duplicates]);
  return { ...merged, duplicates: [...dupes] };
}
