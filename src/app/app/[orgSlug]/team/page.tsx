import { Avatar } from "@/components/brand";
import { Icon } from "@/components/icons";
import { requireOrgMembership, requireUser, type Role } from "@/lib/auth";
import { getProfiles, isPendingInvite } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";
import { ROLES_FOR_UI } from "./roles";
import { InviteForm, MemberControls } from "./team-forms";

export const metadata = { title: "Team · Mantle" };

type Member = { userId: string; role: Role; email: string; pending: boolean; invitedAt: string | null };

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
      pending: isPendingInvite(profile),
      invitedAt: profile?.invitedAt ?? null,
    };
  });
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function TeamPage({ params }: PageProps<"/app/[orgSlug]/team">) {
  const user = await requireUser();
  const { orgId, orgName, role } = await requireOrgMembership((await params).orgSlug);
  const members = await loadMembers(orgId);
  const isAdmin = role === "admin";
  const anAdmin = members.find((m) => m.role === "admin" && !m.pending)?.email;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
      {isAdmin ? null : (
        <div className="co-banner" role="status">
          <Icon name="lock" />
          <span>
            You&apos;re a {role}, so you can see the team but not change it.{anAdmin ? ` ${anAdmin}, an admin, can.` : " Only admins can."}
          </span>
        </div>
      )}
      <div>
        <h1 style={{ fontSize: 28 }}>Team</h1>
        <p className="ink2" style={{ marginTop: 4 }}>People who can open {orgName}.</p>
      </div>

      {isAdmin ? <InviteForm orgId={orgId} /> : null}

      <section className="card" style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th className="r">
                <span className="sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.userId === user.id;
              const roleLabel = ROLES_FOR_UI.find((r) => r.value === m.role)?.label ?? m.role;
              return (
                <tr key={m.userId}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {m.pending ? (
                        <span className="avatar" style={{ background: "#fff", border: "1px dashed var(--line-2)" }} aria-hidden="true">?</span>
                      ) : (
                        <Avatar name={m.email} />
                      )}
                      <span>
                        <span className="strong" style={m.pending ? { color: "var(--ink-2)" } : undefined}>{m.email}</span>
                        {isSelf ? <span className="xs muted"> (you)</span> : null}
                        {m.pending ? (
                          <span className="xs muted" style={{ display: "block" }}>
                            Invite pending{m.invitedAt ? ` · sent ${shortDate(m.invitedAt)}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  {isAdmin ? (
                    <MemberControls orgId={orgId} userId={m.userId} email={m.email} role={m.role} isSelf={isSelf} pending={m.pending} />
                  ) : (
                    <>
                      <td>
                        <span className="small ink2">{roleLabel}</span>
                      </td>
                      <td />
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="xs muted" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
          A company always keeps at least one admin, so the last admin can&apos;t leave or be removed. Recruiters and viewers see this page read-only.
        </p>
      </section>
    </main>
  );
}
