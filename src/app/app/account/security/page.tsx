import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAssuranceLevels, listMemberships, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SECURITY_PATH, VERIFY_PATH, safeNext } from "../mfa-gate";
import { EnrollPanel } from "./enroll-panel";
import { RemoveFactorButton } from "./remove-factor-button";

export const metadata = { title: "Two-factor authentication · Assessment Platform" };

const muted = "text-neutral-600 dark:text-neutral-400";

export default function SecurityPage({ searchParams }: PageProps<"/app/account/security">) {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Two-factor authentication</h1>
      <Suspense fallback={<p className={`text-sm ${muted}`}>Loading…</p>}>
        <Security searchParams={searchParams} />
      </Suspense>
    </div>
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
  const isAdmin = memberships.some((m) => m.role === "admin");

  return (
    <div className="space-y-8">
      {next && factors.length === 0 ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Company admins must use two-factor authentication. Set up an authenticator app to continue.
        </p>
      ) : null}
      {params.error === "remove" ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Could not remove that authenticator app. Sign in again and retry.
        </p>
      ) : null}

      <section className="space-y-2 text-sm">
        <p>
          When you sign in, you enter your password and then a 6-digit code from an authenticator app on your phone
          (for example 1Password, Google Authenticator or Microsoft Authenticator).
          {isAdmin ? " Admins must have it turned on to use their company." : " It's optional for recruiters and viewers, and recommended."}
        </p>
        <p className={muted}>
          Keep your authenticator app safe: lock your phone, turn on the app&apos;s own backup, and never share a code or the
          setup key with anyone. Our team will never ask for them. If you lose access to your authenticator, you won&apos;t
          be able to sign in until support resets it, so adding a second app on another device is a good idea.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="factors-heading">
        <h2 id="factors-heading" className="text-lg font-medium">Your authenticator apps</h2>
        {factors.length ? (
          <ul aria-label="Authenticator apps" className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{f.friendly_name || "Authenticator app"}</p>
                  <p className={muted}>Added {new Date(f.created_at).toISOString().slice(0, 10)}</p>
                </div>
                <RemoveFactorButton factorId={f.id} name={f.friendly_name || "this authenticator app"} last={factors.length === 1} isAdmin={isAdmin} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={`text-sm ${muted}`}>Two-factor authentication is off. No authenticator app is set up.</p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="add-heading">
        <h2 id="add-heading" className="text-lg font-medium">{factors.length ? "Add another authenticator app" : "Turn on two-factor authentication"}</h2>
        <EnrollPanel next={next} label={factors.length ? "Add another authenticator app" : "Set up an authenticator app"} />
      </section>
    </div>
  );
}
