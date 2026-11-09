import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Data access layer for company users. Pages and server actions call these;
// RLS is the second line of defense underneath.

export type Role = "admin" | "recruiter" | "viewer";
export const ROLES: readonly Role[] = ["admin", "recruiter", "viewer"] as const;

export type Membership = {
  orgId: string;
  orgName: string;
  role: Role;
};

// Cookie holding the org the user last switched to. It is only a preference:
// every read re-checks it against the user's memberships.
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
    .select("org_id, role, organizations(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((m) => ({
    orgId: m.org_id,
    orgName: m.organizations?.name ?? "Unnamed company",
    role: m.role as Role,
  }));
});

/**
 * The org the user is working in. Uses the active_org cookie if it matches a
 * real membership, otherwise their first org. No orgs → /onboarding.
 */
export const requireActiveMembership = cache(async (): Promise<Membership> => {
  await requireUser();
  const memberships = await listMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return memberships.find((m) => m.orgId === preferred) ?? memberships[0];
});

/**
 * Throws AuthorizationError unless the current user belongs to orgId, and
 * (if given) holds one of the roles. Use at the top of every server action.
 */
export async function requireMembership(orgId: string, roles?: readonly Role[]): Promise<Membership & { userId: string }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Please sign in again.");
  const membership = (await listMemberships()).find((m) => m.orgId === orgId);
  if (!membership) throw new AuthorizationError();
  if (roles && !roles.includes(membership.role)) throw new AuthorizationError();
  return { ...membership, userId: user.id };
}
