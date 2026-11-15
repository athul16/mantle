import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { AuthCard, Notice } from "@/components/ui";
import { getAssuranceLevels, listMemberships, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SECURITY_PATH, VERIFY_PATH, mfaRequired, safeNext } from "../mfa-gate";
import { AccountShell } from "../shell";
import { EnrollPanel } from "./enroll-panel";
import { RemoveFactorButton } from "./remove-factor-button";

export const metadata = { title: "Two-factor authentication · Mantle" };

const SAFETY =
  "Keep your authenticator app safe: lock your phone, turn on the app's own backup, and never share a code or the setup key with anyone. Our team will never ask for them. If you lose access to your authenticator, you won't be able to sign in until support resets it, so adding a second app on another device is a good idea.";

export default function SecurityPage({ searchParams }: PageProps<"/app/account/security">) {
  return (
    <Suspense fallback={<p className="small muted" style={{ padding: 32 }}>Loading…</p>}>
      <Security searchParams={searchParams} />
    </Suspense>
  );
}

async function Security({ searchParams }: { searchParams: PageProps<"/app/account/security">["searchParams"] }) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const next = rawNext ? safeNext(rawNext) : undefined;
  await requireUser();
  const aal = await getAssuranceLevels();
  // With a factor but only a password so far, Supabase won't let them change
  // factors: ask for the code first, then come back here.
  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    const back = next ? `${SECURITY_PATH}?next=${encodeURIComponent(next)}` : SECURITY_PATH;
    redirect(`${VERIFY_PATH}?next=${encodeURIComponent(back)}`);
  }

  const supabase = await createClient();
  const [{ data: factorData }, memberships] = await Promise.all([supabase.auth.mfa.listFactors(), listMemberships()]);
  const factors = (factorData?.totp ?? []).filter((f) => f.status === "verified");
  // Admins and recruiters must use it, and viewers when their company shows them candidate media.
  const required = memberships.some((m) => mfaRequired(m.role, m.viewersSeeMedia));
  const removeError =
    params.error === "remove" ? <Notice tone="bad">Could not remove that authenticator app. Sign in again and retry.</Notice> : null;

  // Someone sent here to set up two-factor before opening their company: the
  // centred setup screen, no company navigation (they can't use it yet).
  if (next && factors.length === 0) {
    return (
      <AuthCard
        title="Turn on two-factor authentication"
        width={480}
        above={
          <div
            role="status"
            className="row g10"
            style={{ padding: "12px 16px", borderRadius: 10, background: "var(--accent-soft)", border: "1px solid var(--accent-line)", color: "var(--accent-ink)" }}
          >
            <Icon name="shield" />
            <span className="small">Your role in this company requires two-factor authentication. Set up an authenticator app to continue.</span>
          </div>
        }
        below={<p className="xs muted" style={{ textAlign: "center" }}>{SAFETY}</p>}
      >
        {removeError}
        <EnrollPanel next={next} label="Set up an authenticator app" primary />
      </AuthCard>
    );
  }

  return (
    <AccountShell>
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "40px 24px 120px", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontSize: 26 }}>Two-factor authentication</h1>
        {removeError}
        <Card>
          <h2 style={{ fontSize: 22 }} id="factors-heading">Your authenticator apps</h2>
          {factors.length ? (
            <>
              <ul aria-label="Authenticator apps" style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 8 }}>
                {factors.map((f, i) => (
                  <li key={f.id} className="row g10" style={{ padding: "12px 14px", borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <Icon name="phone" />
                    <span style={{ flex: 1 }}>
                      <span className="small strong" style={{ display: "block" }}>{displayName(f.friendly_name)}</span>
                      <span className="xs muted">Added {formatDate(f.created_at)}</span>
                    </span>
                    <RemoveFactorButton factorId={f.id} name={f.friendly_name || "this authenticator app"} last={factors.length === 1} required={required} />
                  </li>
                ))}
              </ul>
              <span className="badge b-ok" style={{ alignSelf: "flex-start" }}>
                <Icon name="check" />
                Two-factor authentication is on
              </span>
            </>
          ) : (
            <>
              <p className="small ink2">
                When you sign in, you enter your password and then a 6-digit code from an authenticator app on your phone (for example 1Password, Google
                Authenticator or Microsoft Authenticator).
              </p>
              <span className="badge" style={{ alignSelf: "flex-start" }}>
                <Icon name="circle" />
                Two-factor authentication is off
              </span>
            </>
          )}
          <EnrollPanel next={next} label={factors.length ? "Add another authenticator app" : "Set up an authenticator app"} primary={!factors.length} />
          <p className="xs muted">
            {required
              ? "Your role requires it: admins and recruiters must have it turned on, and viewers too when their company shows them candidate snapshots."
              : "It's optional for you, and recommended."}
          </p>
        </Card>
        <p className="xs muted">{SAFETY}</p>
      </main>
    </AccountShell>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="factors-heading" className="card raised" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      {children}
    </section>
  );
}

/** "Authenticator app (2026-11-10 14:02 UTC)" → "Authenticator app"; the date is shown separately. */
function displayName(friendly: string | null | undefined) {
  return (friendly || "Authenticator app").replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, "") || "Authenticator app";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
