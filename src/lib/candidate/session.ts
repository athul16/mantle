import "server-only";

import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { hashToken } from "@/lib/tokens";
import { SESSION_COOKIE, SESSION_COOKIE_PATHS, SESSION_MAX_AGE_SECONDS } from "./config";
import {
  ATTEMPT_COLUMNS,
  findInviteByToken,
  loadInvite,
  looksLikeToken,
  type AttemptRow,
  type InviteContext,
} from "./invite";

/**
 * A verified candidate: the attempt their session cookie points at, plus its
 * invite. Every candidate read and write starts from one of these, and every
 * query is filtered by its attempt id and org id. Nothing the browser sends
 * can name a different attempt.
 */
export interface CandidateSession {
  attempt: AttemptRow;
  invite: InviteContext;
}

/** Looks up the attempt for a raw session token. Null for unknown or malformed tokens. */
export async function getCandidateSession(sessionToken: string | undefined | null): Promise<CandidateSession | null> {
  if (!sessionToken || !looksLikeToken(sessionToken)) return null;
  const db = createServiceClient();

  const { data: secret, error } = await db
    .from("attempt_secrets")
    .select("attempt_id, org_id")
    .eq("session_token_hash", hashToken(sessionToken))
    .maybeSingle();
  if (error) throw new Error(`session lookup failed: ${error.message}`);
  if (!secret) return null;

  const { data: attempt, error: attemptError } = await db
    .from("attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", secret.attempt_id)
    .eq("org_id", secret.org_id)
    .single();
  if (attemptError) throw new Error(`attempt lookup failed: ${attemptError.message}`);

  const invite = await loadInvite(attempt.invite_id);
  if (!invite || invite.orgId !== attempt.org_id) return null;
  return { attempt: attempt as AttemptRow, invite };
}

/** Session token from the request cookies (pages and server components). */
export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * The session for a page under /a/[token]: the cookie's attempt, but only if
 * it belongs to the same invite as the link token. Opening candidate B's link
 * with candidate A's cookie gives null, not A's or B's attempt.
 */
export async function sessionForToken(
  token: string,
  sessionToken: string | undefined | null,
): Promise<CandidateSession | null> {
  const session = await getCandidateSession(sessionToken);
  if (!session) return null;
  const invite = await findInviteByToken(token);
  if (!invite || invite.inviteId !== session.invite.inviteId) return null;
  return session;
}

/**
 * Set-Cookie header values for the session, one per path (/a for pages,
 * /api/candidate for the route handlers). Written by hand because
 * ResponseCookies keys by name and would keep only one of the two paths.
 */
export function sessionCookieHeaders(sessionToken: string): string[] {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return SESSION_COOKIE_PATHS.map(
    (path) =>
      `${SESSION_COOKIE}=${sessionToken}; Path=${path}; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
  );
}
