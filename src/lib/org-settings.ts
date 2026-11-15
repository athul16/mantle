/**
 * organizations.settings->'contact_email': whom candidates should contact
 * about accommodations (decision D9). Shown in the monitoring notice and on
 * the candidate verify page. Pure functions, no server imports. The database
 * checks the same shape (organizations_contact_email_format) and
 * set_contact_email() trims and lower-cases it.
 */

export const MAX_CONTACT_EMAIL_LENGTH = 254;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const CONTACT_EMAIL_ERROR = "Enter a valid email address, or leave it blank.";

/** organizations.settings → the contact email, or null when unset or invalid. */
export function readContactEmail(settings: unknown): string | null {
  const value = (settings as { contact_email?: unknown } | null | undefined)?.contact_email;
  return typeof value === "string" && EMAIL.test(value) && value.length <= MAX_CONTACT_EMAIL_LENGTH ? value : null;
}

export type ParsedContactEmail = { ok: true; email: string | null } | { ok: false; error: string };

/** Form input → email (null clears it). */
export function parseContactEmail(input: unknown): ParsedContactEmail {
  const text = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!text) return { ok: true, email: null };
  if (text.length < 3 || text.length > MAX_CONTACT_EMAIL_LENGTH || !EMAIL.test(text)) return { ok: false, error: CONTACT_EMAIL_ERROR };
  return { ok: true, email: text };
}
