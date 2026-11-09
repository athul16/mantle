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

/** Text the candidate agrees to on the verify page. Stored by version with the consent event. */
export const CONSENT_VERSION = "2026-11-09";
export const CONSENT_TEXT =
  "I agree that my answers, the time I spend on each task, and my activity in this test window are recorded and shared with the hiring company. If the company turns on camera or screen monitoring, I will be told before it starts.";
