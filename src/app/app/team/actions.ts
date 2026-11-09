"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { AuthorizationError, ROLES, requireMembership, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Every action: (1) check the caller is an admin of the org on the server,
// (2) do the write with the caller's own client so RLS checks it again.
// The service client is used only for Supabase Auth admin calls.

const role = z.enum(ROLES as [Role, ...Role[]]);

const inviteSchema = z.object({
  orgId: z.uuid(),
  email: z.email({ error: "Enter a valid email." }).trim().toLowerCase(),
  role,
});

const memberSchema = z.object({ orgId: z.uuid(), userId: z.uuid() });

function fail(err: unknown): FormState {
  if (err instanceof AuthorizationError) return { error: err.message };
  throw err;
}

export async function inviteTeammate(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { orgId, email, role: newRole } = parsed.data;

  try {
    await requireMembership(orgId, ["admin"]);
  } catch (err) {
    return fail(err);
  }

  const service = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let userId: string | undefined;
  let emailed = false;

  const invited = await service.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}/auth/callback` });
  if (invited.data.user) {
    userId = invited.data.user.id;
    emailed = true;
  } else if (invited.error?.code === "email_exists") {
    // Already has an account (e.g. belongs to another company). generateLink
    // returns the existing user without sending any email.
    const existing = await service.auth.admin.generateLink({ type: "magiclink", email });
    userId = existing.data.user?.id;
  } else if (invited.error?.code === "email_address_invalid") {
    return { fieldErrors: { email: ["Supabase rejected this address. Check it's a real, deliverable email."] } };
  } else if (invited.error?.code === "over_email_send_rate_limit") {
    return { error: "Supabase's email limit was hit. Try again later, or set up custom SMTP." };
  }
  if (!userId) {
    console.error("inviteTeammate failed", { code: invited.error?.code, status: invited.error?.status, message: invited.error?.message });
    return { error: "Could not invite that email. Try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("memberships").insert({ org_id: orgId, user_id: userId, role: newRole });
  if (error) {
    if (error.code === "23505") return { error: `${email} is already on the team.` };
    return { error: "Could not add them to the team." };
  }

  revalidatePath("/app/team");
  return {
    message: emailed
      ? `Invite sent to ${email}. They'll set a password from the email link.`
      : `${email} already has an account and was added as ${newRole}. They can sign in now.`,
  };
}

/** Count admins in the org, as seen by the caller (RLS-scoped). */
async function adminCount(orgId: string) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "admin");
  if (error) throw error;
  return count ?? 0;
}

async function currentRole(orgId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("memberships").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  return data?.role as Role | undefined;
}

export async function changeRole(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = memberSchema.extend({ role }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, userId, role: newRole } = parsed.data;

  try {
    await requireMembership(orgId, ["admin"]);
  } catch (err) {
    return fail(err);
  }

  const existing = await currentRole(orgId, userId);
  if (!existing) return { error: "That person isn't on the team." };
  if (existing === newRole) return undefined;
  if (existing === "admin" && (await adminCount(orgId)) <= 1) {
    return { error: "A company needs at least one admin. Make someone else an admin first." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("memberships").update({ role: newRole }).eq("org_id", orgId).eq("user_id", userId).select("user_id");
  if (error || data.length !== 1) return { error: "Could not change the role." };

  revalidatePath("/app");
  return { message: "Role updated." };
}

export async function removeMember(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { orgId, userId } = parsed.data;

  try {
    await requireMembership(orgId, ["admin"]);
  } catch (err) {
    return fail(err);
  }

  const existing = await currentRole(orgId, userId);
  if (!existing) return { error: "That person isn't on the team." };
  if (existing === "admin" && (await adminCount(orgId)) <= 1) {
    return { error: "You can't remove the last admin. Make someone else an admin first." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId).select("user_id");
  if (error || data.length !== 1) return { error: "Could not remove them." };

  revalidatePath("/app");
  return { message: "Removed from the team." };
}
