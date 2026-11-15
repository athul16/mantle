/** Candidate-flow constants. Shared by pages, route handlers and tests. */

/** Session cookie. Set twice: once for path /a and once for /api/candidate. */
export const SESSION_COOKIE = "ap_candidate";
export const SESSION_COOKIE_PATHS = ["/a", "/api/candidate"] as const;
/** Cookie lifetime. The attempt's own deadline is enforced separately on the server. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
/** Minimum gap between two code emails for the same invite. */
export const CODE_RESEND_SECONDS = 30;

/** Action event kinds the browser may report. Everything else is recorded by the server itself. */
export const CLIENT_EVENT_KINDS = ["opened_message", "started_step"] as const;
export type ClientEventKind = (typeof CLIENT_EVENT_KINDS)[number];

/**
 * The consent box on the verify page, under the "What's recorded, and why"
 * table. Stored by version with the verified event (and, for monitored
 * assessments, the monitoring consent). Change the version when the text or
 * the table changes.
 */
export const CONSENT_VERSION = "2026-11-11.verify-table";

/** Label of the verify page's consent box for an assessment's monitoring settings. */
export function consentLabel(monitoring: { camera: boolean; screen: boolean }): string {
  const parts = [monitoring.camera ? "camera snapshots" : null, monitoring.screen ? "screen sharing" : null, "activity recording"].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `I've read this and agree to ${list} for this simulation.`;
}

/** The label for an assessment without camera or screen monitoring. */
export const CONSENT_TEXT = consentLabel({ camera: false, screen: false });
