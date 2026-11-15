/**
 * Per-invite accommodations (decision D9): extra time and waivers of the
 * camera, screen share, full screen and microphone, set by an admin or
 * recruiter before the candidate starts. Waiving the camera also waives the
 * gaze check, which needs it. Stored in invite_accommodations and written only through
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
  waiveFullscreen: boolean;
  waiveMicrophone: boolean;
};

export const NO_ACCOMMODATIONS: Accommodations = {
  extraTimePercent: 0,
  waiveCamera: false,
  waiveScreen: false,
  waiveFullscreen: false,
  waiveMicrophone: false,
};

/** An invite_accommodations row as selected from the database. The v2 waiver columns are optional so older selects still work. */
export type AccommodationsRow = {
  extra_time_percent: number;
  waive_camera: boolean;
  waive_screen: boolean;
  waive_fullscreen?: boolean | null;
  waive_microphone?: boolean | null;
};

/** An invite_accommodations row (or null) as Accommodations. Unknown percents count as none. */
export function readAccommodations(row: AccommodationsRow | null | undefined): Accommodations {
  if (!row) return NO_ACCOMMODATIONS;
  const pct = (EXTRA_TIME_PERCENTS as readonly number[]).includes(row.extra_time_percent)
    ? (row.extra_time_percent as ExtraTimePercent)
    : 0;
  return {
    extraTimePercent: pct,
    waiveCamera: row.waive_camera === true,
    waiveScreen: row.waive_screen === true,
    waiveFullscreen: row.waive_fullscreen === true,
    waiveMicrophone: row.waive_microphone === true,
  };
}

export function hasAccommodations(a: Accommodations): boolean {
  return a.extraTimePercent > 0 || a.waiveCamera || a.waiveScreen || a.waiveFullscreen || a.waiveMicrophone;
}

/**
 * The time limit this candidate gets, in whole minutes (rounded up, in the
 * candidate's favour). The server sets attempts.deadline_at from this when the
 * attempt starts; the browser countdown only shows that deadline.
 */
export function effectiveTimeLimitMinutes(baseMinutes: number, extraTimePercent: number): number {
  return Math.ceil((baseMinutes * (100 + extraTimePercent)) / 100);
}

type WaivableSettings = { camera: boolean; screen: boolean; fullscreen?: boolean; microphone?: boolean; gaze?: boolean };

/**
 * The assessment's proctoring settings with this candidate's waivers applied.
 * A waiver only turns a setting off, never on. Gaze needs the camera, so it
 * goes off with it. Settings the object doesn't have are left out.
 */
export function applyWaivers<T extends WaivableSettings>(settings: T, a: Accommodations): T {
  const out: WaivableSettings = { ...settings, camera: settings.camera && !a.waiveCamera, screen: settings.screen && !a.waiveScreen };
  if ("fullscreen" in settings) out.fullscreen = settings.fullscreen === true && !a.waiveFullscreen;
  if ("microphone" in settings) out.microphone = settings.microphone === true && !a.waiveMicrophone;
  if ("gaze" in settings) out.gaze = settings.gaze === true && out.camera;
  return out as T;
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
  if (a.waiveFullscreen) out.push("full screen waived");
  if (a.waiveMicrophone) out.push("microphone waived");
  return out;
}
