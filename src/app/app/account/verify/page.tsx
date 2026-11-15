import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { AuthCard } from "@/components/ui";
import { getAssuranceLevels, requireUser } from "@/lib/auth";
import { SECURITY_PATH, safeNext } from "../mfa-gate";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Sign-in code · Mantle" };

// Second step of signing in for anyone with an authenticator app (aal1 → aal2).
export default function VerifyPage({ searchParams }: PageProps<"/app/account/verify">) {
  return (
    <AuthCard
      title="Enter your sign-in code"
      icon={
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", background: "var(--subtle)", color: "var(--ink-2)" }}>
          <Icon name="phone" className="i-lg" />
        </span>
      }
      intro="Open the authenticator app you set up for this account and enter the 6-digit code it shows."
      below={
        <p className="xs muted" style={{ textAlign: "center" }}>
          Lost your phone or authenticator app? Contact support to reset two-factor for your account. Nobody from our team will ever ask you for a code.
        </p>
      }
    >
      <Suspense fallback={<p className="small muted">Loading…</p>}>
        <Verify searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Verify({ searchParams }: { searchParams: PageProps<"/app/account/verify">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  await requireUser();
  const aal = await getAssuranceLevels();
  if (aal.currentLevel === "aal2") redirect(next);
  if (aal.nextLevel !== "aal2") redirect(`${SECURITY_PATH}?next=${encodeURIComponent(next)}`);
  return <VerifyForm next={next} />;
}
