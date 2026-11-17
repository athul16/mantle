import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { requireOrgMembership } from "@/lib/auth";
import { readRetention } from "@/lib/retention/policy";
import { createClient } from "@/lib/supabase/server";
import { readContactEmail } from "@/lib/org-settings";
import { ContactEmailForm } from "./contact-email-form";
import { RetentionForm } from "./retention-form";

export const metadata = { title: "Settings · Mantle" };

// Org settings. Every member can see them; only admins can change them.
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgId, orgName, role } = await requireOrgMembership((await params).orgSlug);
  const db = await createClient();
  const { data, error } = await db.from("organizations").select("settings").eq("id", orgId).single();
  if (error) throw error;
  const retention = readRetention(data.settings);
  const isAdmin = role === "admin";
  const contactEmail = readContactEmail(data.settings);

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
        <Row id="retention-heading" title="Candidate data retention" sub="Deleted automatically, counted from when the assessment ends">
          {isAdmin ? (
            <RetentionForm orgId={orgId} mediaDays={retention.mediaDays} resultsDays={retention.resultsDays} />
          ) : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <li>Photos and screenshots are kept for {retention.mediaDays} days after the assessment ends.</li>
              <li>Results are kept for {retention.resultsDays} days after the assessment ends.</li>
            </ul>
          )}
          <p className="small ink2">{RETENTION_NOTE}</p>
        </Row>
        <Row id="contact-heading" title="Candidate contact" sub="Whom candidates ask for accommodations">
          {isAdmin ? (
            <ContactEmailForm orgId={orgId} email={contactEmail} />
          ) : (
            <p className="small">{contactEmail ? `Candidates are told to contact ${contactEmail}.` : "No contact email is set."}</p>
          )}
          <p className="small ink2">Candidates email this address to ask for extra time or to skip camera and screen sharing.</p>
        </Row>
        <Row id="security-heading" title="Sign-in security" sub="Two-factor authentication" last>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="badge b-ok">
              <Icon name="check" />
              Required for admins and recruiters
            </span>
            <span className="small ink2">Viewers need it too when they can see photos and screenshots.</span>
          </div>
          <Link href="/app/account/security" className="small">Manage your authenticator apps</Link>
        </Row>
      </section>
    </main>
  );
}

const RETENTION_NOTE =
  "Photos and screenshots are deleted first, results later. Candidates see both periods before they start. You can also delete one candidate's data from their report.";

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
