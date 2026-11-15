/**
 * How long candidate data is kept (docs/02 Compliance). Pure functions, no
 * server imports, so the settings form, the consent notice and tests share
 * them. The database applies the same rules (migration *_retention_clocks.sql):
 * the bounds as a check constraint, the clocks in list_media_past_retention and
 * list_candidates_past_retention.
 */

/**
 * Two clocks: media (camera snapshots and screen screenshots) and results
 * (everything else about the candidate). Media is never kept longer than results.
 */
export const DEFAULT_MEDIA_RETENTION_DAYS = 90;
export const MIN_MEDIA_RETENTION_DAYS = 30;
export const MAX_MEDIA_RETENTION_DAYS = 365;

export const DEFAULT_RESULTS_RETENTION_DAYS = 365;
export const MIN_RESULTS_RETENTION_DAYS = 30;
export const MAX_RESULTS_RETENTION_DAYS = 730;

const DAY_MS = 86_400_000;

export const MEDIA_RANGE_ERROR = `Enter a whole number of days from ${MIN_MEDIA_RETENTION_DAYS} to ${MAX_MEDIA_RETENTION_DAYS}.`;
export const RESULTS_RANGE_ERROR = `Enter a whole number of days from ${MIN_RESULTS_RETENTION_DAYS} to ${MAX_RESULTS_RETENTION_DAYS}.`;
export const MEDIA_LONGER_ERROR = "Photos and screenshots can't be kept longer than results.";

export type Retention = { mediaDays: number; resultsDays: number };

const inMediaRange = (n: number) => Number.isInteger(n) && n >= MIN_MEDIA_RETENTION_DAYS && n <= MAX_MEDIA_RETENTION_DAYS;
const inResultsRange = (n: number) => Number.isInteger(n) && n >= MIN_RESULTS_RETENTION_DAYS && n <= MAX_RESULTS_RETENTION_DAYS;

/** organizations.settings → both periods, with the defaults for missing or invalid values. */
export function readRetention(settings: unknown): Retention {
  const s = (settings ?? {}) as { media_retention_days?: unknown; results_retention_days?: unknown };
  const media = s.media_retention_days;
  const results = s.results_retention_days;
  const resultsDays = typeof results === "number" && inResultsRange(results) ? results : DEFAULT_RESULTS_RETENTION_DAYS;
  const mediaDays = typeof media === "number" && inMediaRange(media) ? media : DEFAULT_MEDIA_RETENTION_DAYS;
  return { mediaDays: Math.min(mediaDays, resultsDays), resultsDays };
}

export type ParsedRetention =
  | ({ ok: true } & Retention)
  | { ok: false; fieldErrors: { mediaRetentionDays?: string[]; resultsRetentionDays?: string[] } };

const wholeNumber = (input: unknown): number | null => {
  const text = typeof input === "string" ? input.trim() : "";
  return /^\d+$/.test(text) ? Number(text) : null;
};

/** Form input → both periods. */
export function parseRetention(mediaInput: unknown, resultsInput: unknown): ParsedRetention {
  const mediaDays = wholeNumber(mediaInput);
  const resultsDays = wholeNumber(resultsInput);
  const fieldErrors: { mediaRetentionDays?: string[]; resultsRetentionDays?: string[] } = {};
  if (mediaDays === null || !inMediaRange(mediaDays)) fieldErrors.mediaRetentionDays = [MEDIA_RANGE_ERROR];
  if (resultsDays === null || !inResultsRange(resultsDays)) fieldErrors.resultsRetentionDays = [RESULTS_RANGE_ERROR];
  if (fieldErrors.mediaRetentionDays || fieldErrors.resultsRetentionDays || mediaDays === null || resultsDays === null) {
    return { ok: false, fieldErrors };
  }
  if (mediaDays > resultsDays) return { ok: false, fieldErrors: { mediaRetentionDays: [MEDIA_LONGER_ERROR] } };
  return { ok: true, mediaDays, resultsDays };
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
