import { safeNext as safeRedirect } from "@/lib/safe-redirect";

// The two-factor rule (docs/02-security-and-integrity.md), as pure functions so
// the proxy (src/lib/supabase/proxy.ts) and the data access layer
// (src/lib/auth.ts) apply exactly the same rule.

export type AssuranceLevel = "aal1" | "aal2" | (string & {}) | null;
/** From supabase.auth.mfa.getAuthenticatorAssuranceLevel(). */
export type AssuranceLevels = { currentLevel: AssuranceLevel; nextLevel: AssuranceLevel };
export type MfaGate = "ok" | "enroll" | "verify";

export const SECURITY_PATH = "/app/account/security";
export const VERIFY_PATH = "/app/account/verify";

/** `settings.viewers_see_media` from an organization's settings JSON (off unless exactly true). */
export function viewersSeeMedia(settings: unknown): boolean {
  return typeof settings === "object" && settings !== null && (settings as { viewers_see_media?: unknown }).viewers_see_media === true;
}

/**
 * Whether a member with `role` must use two-factor in a company. Everyone who
 * can see proctoring snapshots or act on candidates must: admins and
 * recruiters always, viewers only when the company lets viewers see media.
 */
export function mfaRequired(role: string | null | undefined, viewersCanSeeMedia = false): boolean {
  return role === "admin" || role === "recruiter" || (role === "viewer" && viewersCanSeeMedia);
}

/**
 * What a member must do before using a company where they hold `role`.
 * Members who must use two-factor (mfaRequired) need aal2 (password +
 * authenticator code in this session). Without a verified factor they enrol;
 * with one but only a password so far, they verify.
 *
 * Only `currentLevel` lets anyone through, and it comes from the access token,
 * which the server verifies. `nextLevel` (from the cookie's copy of the user's
 * factors) only chooses between enrol and verify.
 */
export function mfaGate(
  role: string | null | undefined,
  { currentLevel, nextLevel }: AssuranceLevels,
  { viewersSeeMedia: viewersCanSeeMedia = false }: { viewersSeeMedia?: boolean } = {},
): MfaGate {
  if (!mfaRequired(role, viewersCanSeeMedia)) return "ok";
  if (currentLevel === "aal2" && nextLevel === "aal2") return "ok";
  return nextLevel === "aal2" ? "verify" : "enroll";
}

/** Where to send a member who isn't at aal2, remembering where they were going. */
export function mfaRedirectPath(gate: Exclude<MfaGate, "ok">, next: string): string {
  return `${gate === "enroll" ? SECURITY_PATH : VERIFY_PATH}?next=${encodeURIComponent(next)}`;
}

/** A same-site path to continue to after enrolling or verifying, never the code page itself (no loops). */
export function safeNext(next: unknown, fallback = "/app"): string {
  const path = safeRedirect(next, fallback);
  if (path.split(/[?#]/)[0] === VERIFY_PATH) return fallback;
  return path;
}
