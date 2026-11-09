export type InviteStatus = "invited" | "started" | "completed" | "expired" | "revoked";

export const INVITE_STATUSES: readonly InviteStatus[] = ["invited", "started", "completed", "expired", "revoked"];

/**
 * Status to show. An invite still marked "invited" whose expiry has passed is
 * shown as expired even before a background job updates the row.
 */
export function displayStatus(status: string, expiresAt: string, now = Date.now()): InviteStatus {
  if (status === "invited" && new Date(expiresAt).getTime() <= now) return "expired";
  return (INVITE_STATUSES as readonly string[]).includes(status) ? (status as InviteStatus) : "invited";
}

/** Resend issues a new link; only for invites the candidate hasn't started. */
export function canResend(status: InviteStatus) {
  return status === "invited" || status === "expired";
}

/** Revoke stops a link from working; not for attempts already started or done. */
export function canRevoke(status: InviteStatus) {
  return status === "invited" || status === "expired";
}

/** Days an invite stays valid when its job has no deadline. */
export const DEFAULT_INVITE_DAYS = 14;

/** When a new or resent invite expires: the job deadline, else 14 days out. */
export function inviteExpiry(jobDeadline: string | null, now = Date.now()): Date {
  return jobDeadline ? new Date(jobDeadline) : new Date(now + DEFAULT_INVITE_DAYS * 864e5);
}

/** True once a job's invite deadline is in the past (no deadline: never). */
export function isPast(iso: string | null, now = Date.now()): boolean {
  return iso !== null && new Date(iso).getTime() <= now;
}
