import "server-only";

import { redirect } from "next/navigation";
import { settleAttempt } from "./attempt";
import { findAttemptForInvite, findInviteByToken, inviteBlockReason, type AttemptRow, type InviteContext } from "./invite";
import { readSessionToken, sessionForToken, type CandidateSession } from "./session";

/**
 * Where a candidate stands for one invite link, as seen by the /a pages.
 * Reading this never writes anything, except settling an attempt whose
 * deadline has passed (submitting it as a timeout).
 */
export type PageState =
  | { kind: "invalid" }
  | { kind: "blocked"; reason: "revoked" | "expired" | "completed"; invite: InviteContext }
  | { kind: "no_session"; invite: InviteContext; attempt: AttemptRow | null }
  | { kind: "session"; session: CandidateSession; attempt: AttemptRow };

export async function loadPageState(token: string): Promise<PageState> {
  const invite = await findInviteByToken(token);
  if (!invite) return { kind: "invalid" };

  const session = await sessionForToken(token, await readSessionToken());
  if (session) {
    const attempt = await settleAttempt(session);
    return { kind: "session", session: { ...session, attempt }, attempt };
  }

  const attempt = await findAttemptForInvite(invite.inviteId, invite.orgId);
  const blocked = inviteBlockReason(invite, attempt);
  if (blocked) return { kind: "blocked", reason: blocked, invite };
  return { kind: "no_session", invite, attempt };
}

/** Page each attempt status belongs on. */
export function pageForStatus(token: string, attempt: AttemptRow): string {
  if (attempt.status === "in_progress") return `/a/${token}/workspace`;
  if (attempt.status === "not_started") return `/a/${token}/check`;
  return `/a/${token}/done`;
}

/**
 * For pages that need a verified candidate: returns the session, or
 * redirects to the landing page (no session) or to the page matching the
 * attempt's status when it isn't one of `allowed`.
 */
export async function requireSessionPage(
  token: string,
  allowed: AttemptRow["status"][],
): Promise<{ session: CandidateSession; attempt: AttemptRow }> {
  const state = await loadPageState(token);
  if (state.kind !== "session") redirect(`/a/${token}`);
  if (!allowed.includes(state.attempt.status)) redirect(pageForStatus(token, state.attempt));
  return { session: state.session, attempt: state.attempt };
}
