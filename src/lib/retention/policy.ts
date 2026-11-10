/**
 * How long candidate data is kept (docs/02 Compliance). Pure functions, no
 * server imports, so the settings form, the consent notice and tests share
 * them. The database applies the same rules (migration *_retention.sql): the
 * bounds as a check constraint, the clock in list_candidates_past_retention.
 */

export const DEFAULT_RETENTION_DAYS = 180;
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 730;

const DAY_MS = 86_400_000;

export const RETENTION_RANGE_ERROR = `Enter a whole number of days from ${MIN_RETENTION_DAYS} to ${MAX_RETENTION_DAYS}.`;

const inRange = (n: number) => Number.isInteger(n) && n >= MIN_RETENTION_DAYS && n <= MAX_RETENTION_DAYS;

/** organizations.settings → days, with the default for a missing or invalid value. */
export function readRetentionDays(settings: unknown): number {
  const value = (settings as { retention_days?: unknown } | null | undefined)?.retention_days;
  return typeof value === "number" && inRange(value) ? value : DEFAULT_RETENTION_DAYS;
}

export type ParsedRetention = { ok: true; days: number } | { ok: false; error: string };

/** Form input → days. */
export function parseRetentionDays(input: unknown): ParsedRetention {
  const text = typeof input === "string" ? input.trim() : "";
  if (!/^\d+$/.test(text)) return { ok: false, error: RETENTION_RANGE_ERROR };
  const days = Number(text);
  return inRange(days) ? { ok: true, days } : { ok: false, error: RETENTION_RANGE_ERROR };
}

export type RetentionDates = {
  createdAt: Date;
  expiresAt: Date;
  deadlineAt?: Date | null;
  submittedAt?: Date | null;
};

/** The candidate's last activity: the latest of invite creation and expiry, attempt deadline and submission. */
export function retentionAnchor(d: RetentionDates): Date {
  const times = [d.createdAt, d.expiresAt, d.deadlineAt, d.submittedAt].filter((t): t is Date => t instanceof Date);
  return new Date(Math.max(...times.map((t) => t.getTime())));
}

export function retainedUntil(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() + days * DAY_MS);
}

/** True once the whole retention period has passed (strictly after). */
export function isPastRetention(d: RetentionDates, days: number, now: Date): boolean {
  return now.getTime() > retainedUntil(retentionAnchor(d), days).getTime();
}
