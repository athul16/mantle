import Link from "next/link";
import { Suspense } from "react";
import { MantleMark } from "@/components/brand";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/ui";
import { listMemberships, requireUser } from "@/lib/auth";
import { CreateOrgForm } from "./create-org-form";

export const metadata = { title: "Set up your company · Mantle" };

export default function OnboardingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 24px", gap: 28 }}>
      <MantleMark large />
      <ol className="steps" aria-label="Setup progress" style={{ listStyle: "none", padding: 0 }}>
        <li className="step-done" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="step-n">
            <Icon name="check" className="i-sm" />
          </span>
          Your account
        </li>
        <li className="step-line" aria-hidden="true" />
        <li className="step-on" style={{ display: "flex", alignItems: "center", gap: 8 }} aria-current="step">
          <span className="step-n">2</span>Company
        </li>
        <li className="step-line" aria-hidden="true" />
        <li style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="step-n">3</span>Team
        </li>
      </ol>
      <main className="card raised" style={{ width: "100%", maxWidth: 560, padding: 32, display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 24 }}>Set up your company</h1>
          <p className="ink2">Candidates see your name and logo on every screen — we stay in the background.</p>
        </div>
        <Suspense>
          <ExistingOrgs />
        </Suspense>
        <CreateOrgForm />
      </main>
      <p className="small muted">You&apos;ll be the admin. Invite teammates as Admins, Recruiters or Viewers from Team whenever you&apos;re ready.</p>
    </div>
  );
}

async function ExistingOrgs() {
  await requireUser();
  const memberships = await listMemberships();
  if (memberships.length === 0) return null;
  return (
    <Notice tone="info">
      You already belong to {memberships.map((m) => m.orgName).join(", ")}. <Link href="/app" style={{ textDecoration: "underline" }}>Open it</Link> or create another company below.
    </Notice>
  );
}
