import { requireOrgMembership, requireUser, type Role } from "@/lib/auth";
import { getProfiles, isPendingInvite } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";
import { ROLES_FOR_UI } from "./roles";
import { InviteForm, MemberControls } from "./team-forms";

export const metadata = { title: "Team · Assessment Platform" };

type Member = { userId: string; role: Role; email: string; joinedAt: string; pending: boolean };

async function loadMembers(orgId: string): Promise<Member[]> {
  // Membership rows come through RLS as the signed-in user.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  // Emails and invite state come from profiles, also through RLS.
  const profiles = await getProfiles(supabase, data.map((m) => m.user_id));
  return data.map((m) => {
    const profile = profiles.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role as Role,
      email: profile?.email ?? "(unknown)",
      joinedAt: m.created_at,
      pending: isPendingInvite(profile),
    };
  });
}

export default async function TeamPage({ params }: PageProps<"/app/[orgSlug]/team">) {
  const user = await requireUser();
  const { orgId, orgName, role } = await requireOrgMembership((await params).orgSlug);
  const members = await loadMembers(orgId);
  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          People who can access {orgName}.{isAdmin ? "" : " Only admins can change the team."}
        </p>
      </div>

      {isAdmin ? <InviteForm orgId={orgId} /> : null}

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">
                {m.email}
                {m.userId === user.id ? <span className="ml-2 text-xs text-neutral-500">(you)</span> : null}
                {m.pending ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">invite pending</span> : null}
              </p>
              <p className="text-xs text-neutral-500">{ROLES_FOR_UI.find((r) => r.value === m.role)?.hint}</p>
            </div>
            {isAdmin ? (
              <MemberControls orgId={orgId} userId={m.userId} role={m.role} isSelf={m.userId === user.id} />
            ) : (
              <span className="text-sm capitalize text-neutral-700 dark:text-neutral-300">{m.role}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
