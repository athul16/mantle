import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Teammates' emails and invite state come from public.profiles (synced from
// auth.users by a trigger), read with the signed-in user's own client. RLS
// returns only the user's own profile and those of people who share a company
// with them, so no service key is needed. Someone who has left every shared
// company is simply missing from the result.

type Db = SupabaseClient<Database>;

export type Profile = { id: string; email: string | null; invitedAt: string | null; firstSignInAt: string | null };

/** Profiles for these user ids that the signed-in user may see, by id. */
export async function getProfiles(db: Db, ids: readonly string[]): Promise<Map<string, Profile>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await db.from("profiles").select("id, email, invited_at, first_sign_in_at").in("id", unique);
  if (error) throw error;
  return new Map(
    data.map((p) => [p.id, { id: p.id, email: p.email, invitedAt: p.invited_at, firstSignInAt: p.first_sign_in_at }]),
  );
}

/** Emails for these user ids, by id (ids with no visible profile or email are left out). */
export async function getEmails(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, p] of await getProfiles(db, ids)) if (p.email) out.set(id, p.email);
  return out;
}

/** Invited by email and hasn't signed in yet. */
export function isPendingInvite(p: Pick<Profile, "invitedAt" | "firstSignInAt"> | undefined): boolean {
  return Boolean(p?.invitedAt && !p.firstSignInAt);
}
