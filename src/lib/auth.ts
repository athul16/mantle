import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { mfaGate, mfaRedirectPath, type AssuranceLevels } from "@/app/app/account/mfa-gate";
import { createClient } from "@/lib/supabase/server";

// Data access layer for company users. Pages and server actions call these;
// RLS is the second line of defense underneath.

export type Role = "admin" | "recruiter" | "viewer";
export const ROLES: readonly Role[] = ["admin", "recruiter", "viewer"] as const;

export type Membership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
};

// The company being worked in comes from the URL (/app/<orgSlug>/...). This
// cookie only remembers which company plain /app should open; every read
// re-checks it against the user's memberships.
export const ACTIVE_ORG_COOKIE = "active_org";

export class AuthorizationError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** The signed-in user, verified with Supabase Auth, or null. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
});

/**
 * The session's authenticator assurance level: aal1 after a password, aal2
 * after an authenticator code too. `nextLevel` is aal2 when the user has a
 * verified factor. Call after getCurrentUser(), which verifies the token.
 */
export const getAssuranceLevels = cache(async (): Promise<AssuranceLevels> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { currentLevel: null, nextLevel: null };
  return { currentLevel: data.currentLevel, nextLevel: data.nextLevel };
});

export const MFA_REQUIRED_MESSAGE =
  "Admins must use two-factor authentication. Enter the code from your authenticator app (or set one up) and try again.";

/** The signed-in user, or redirect to /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Every org the current user belongs to, with their role in each. */
export const listMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(name, slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.flatMap((m) =>
    m.organizations
      ? [{ orgId: m.org_id, orgName: m.organizations.name, orgSlug: m.organizations.slug, role: m.role as Role }]
      : [],
  );
});

/**
 * Which company plain /app should open: the remembered one if the user still
 * belongs to it, otherwise their first. No companies → /onboarding.
 */
export async function resolveDefaultMembership(): Promise<Membership> {
  await requireUser();
  const memberships = await listMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return memberships.find((m) => m.orgId === preferred) ?? memberships[0];
}

/**
 * The company named in the URL, if the signed-in user belongs to it. Anyone
 * else gets a 404, so URLs don't reveal which companies exist. An admin who
 * isn't at aal2 is sent to set up or enter two-factor (the proxy does this
 * first, with the full path; this is the backstop).
 */
export const requireOrgMembership = cache(async (orgSlug: string): Promise<Membership> => {
  await requireUser();
  const membership = (await listMemberships()).find((m) => m.orgSlug === orgSlug);
  if (!membership) notFound();
  const gate = mfaGate(membership.role, await getAssuranceLevels());
  if (gate !== "ok") redirect(mfaRedirectPath(gate, `/app/${orgSlug}`));
  return membership;
});

/**
 * Throws AuthorizationError unless the current user belongs to orgId, and
 * (if given) holds one of the roles. Use at the top of every server action.
 * An admin of orgId must also be at aal2 (two-factor), whatever the action.
 */
export async function requireMembership(orgId: string, roles?: readonly Role[]): Promise<Membership & { userId: string }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Please sign in again.");
  const membership = (await listMemberships()).find((m) => m.orgId === orgId);
  if (!membership) throw new AuthorizationError();
  if (mfaGate(membership.role, await getAssuranceLevels()) !== "ok") throw new AuthorizationError(MFA_REQUIRED_MESSAGE);
  if (roles && !roles.includes(membership.role)) throw new AuthorizationError();
  return { ...membership, userId: user.id };
}
