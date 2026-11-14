import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { requireOrgMembership } from "@/lib/auth";
import { readRetentionDays } from "@/lib/retention/policy";
import { createClient } from "@/lib/supabase/server";
import { RetentionForm } from "./retention-form";

export const metadata = { title: "Settings · Mantle" };

// Org settings. Every member can see them; only admins can change them.
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgId, orgName, role } = await requireOrgMembership((await params).orgSlug);
  const db = await createClient();
  const { data, error } = await db.from("organizations").select("settings").eq("id", orgId).single();
  if (error) throw error;
  const days = readRetentionDays(data.settings);
  const isAdmin = role === "admin";

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "28px 32px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
      {isAdmin ? null : (
        <div className="co-banner" role="status">
          <Icon name="lock" />
          <span>You&apos;re signed in as a {role}. Only admins can change these settings.</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Settings</h1>
          <p className="ink2" style={{ marginTop: 4 }}>Company-wide settings for {orgName}.</p>
        </div>
        <span style={{ flex: 1 }} />
        <span className="badge">
          <Icon name="lock" />
          Only admins can change these
        </span>
      </div>

      <section className="card" style={{ overflow: "hidden" }}>
        <Row id="retention-heading" title="Candidate data retention" sub="Deleted automatically after this">
          {isAdmin ? (
            <RetentionForm orgId={orgId} days={days} />
          ) : (
            <>
              <p className="small">Candidate data is kept for {days} days after the assessment ends.</p>
              <p className="small ink2">{RETENTION_NOTE}</p>
            </>
          )}
        </Row>
        <Row id="security-heading" title="Sign-in security" sub="Two-factor authentication" last>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="badge b-ok">
              <Icon name="check" />
              Required for admins
            </span>
            <span className="small ink2">Recruiters and viewers can turn it on themselves.</span>
          </div>
          <Link href="/app/account/security" className="small">Manage your authenticator apps</Link>
        </Row>
      </section>
    </main>
  );
}

const RETENTION_NOTE =
  "Covers answers, scores, notes, integrity events and proctoring snapshots. Candidates see this period in the monitoring notice before they agree. You can also delete one candidate's data from their report at any time.";

function Row({ id, title, sub, children, last = false }: { id: string; title: string; sub: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      role="group"
      aria-labelledby={id}
      style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 24, padding: "22px 24px", borderBottom: last ? undefined : "1px solid var(--line)" }}
    >
      <div>
        <h2 id={id} className="strong" style={{ fontFamily: "var(--font)", fontSize: 14, letterSpacing: 0 }}>{title}</h2>
        <div className="small muted">{sub}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}
