/**
 * Per-invite accommodations (decision D9): extra time and a waiver of the
 * camera and/or screen share, set by an admin or recruiter before the
 * candidate starts. Stored in invite_accommodations and written only through
 * the audited set_invite_accommodations() database function.
 *
 * Pure helpers shared by the company pages, the candidate flow and tests.
 * Nothing secret lives here.
 */

export const EXTRA_TIME_PERCENTS = [0, 25, 50, 100] as const;
export type ExtraTimePercent = (typeof EXTRA_TIME_PERCENTS)[number];

export type Accommodations = {
  extraTimePercent: ExtraTimePercent;
  waiveCamera: boolean;
  waiveScreen: boolean;
};

export const NO_ACCOMMODATIONS: Accommodations = { extraTimePercent: 0, waiveCamera: false, waiveScreen: false };

/** An invite_accommodations row (or null) as Accommodations. Unknown percents count as none. */
export function readAccommodations(
  row: { extra_time_percent: number; waive_camera: boolean; waive_screen: boolean } | null | undefined,
): Accommodations {
  if (!row) return NO_ACCOMMODATIONS;
  const pct = (EXTRA_TIME_PERCENTS as readonly number[]).includes(row.extra_time_percent)
    ? (row.extra_time_percent as ExtraTimePercent)
    : 0;
  return { extraTimePercent: pct, waiveCamera: row.waive_camera === true, waiveScreen: row.waive_screen === true };
}

export function hasAccommodations(a: Accommodations): boolean {
  return a.extraTimePercent > 0 || a.waiveCamera || a.waiveScreen;
}

/**
 * The time limit this candidate gets, in whole minutes (rounded up, in the
 * candidate's favour). The server sets attempts.deadline_at from this when the
 * attempt starts; the browser countdown only shows that deadline.
 */
export function effectiveTimeLimitMinutes(baseMinutes: number, extraTimePercent: number): number {
  return Math.ceil((baseMinutes * (100 + extraTimePercent)) / 100);
}

/** The assessment's camera / screen settings with this candidate's waivers applied. */
export function applyWaivers<T extends { camera: boolean; screen: boolean }>(settings: T, a: Accommodations): T {
  return { ...settings, camera: settings.camera && !a.waiveCamera, screen: settings.screen && !a.waiveScreen };
}

/** Short phrases for the company side, e.g. ["+50% time (30 → 45 min)", "camera waived"]. */
export function describeAccommodations(a: Accommodations, baseMinutes?: number): string[] {
  const out: string[] = [];
  if (a.extraTimePercent > 0) {
    out.push(
      baseMinutes === undefined
        ? `+${a.extraTimePercent}% time`
        : `+${a.extraTimePercent}% time (${baseMinutes} → ${effectiveTimeLimitMinutes(baseMinutes, a.extraTimePercent)} min)`,
    );
  }
  if (a.waiveCamera) out.push("camera waived");
  if (a.waiveScreen) out.push("screen share waived");
  return out;
}
