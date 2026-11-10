import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAssuranceLevels, requireUser } from "@/lib/auth";
import { SECURITY_PATH, safeNext } from "../mfa-gate";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Sign-in code · Assessment Platform" };

// Second step of signing in for anyone with an authenticator app (aal1 → aal2).
export default function VerifyPage({ searchParams }: PageProps<"/app/account/verify">) {
  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Enter your sign-in code</h1>
      <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
        <Verify searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Verify({ searchParams }: { searchParams: PageProps<"/app/account/verify">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  await requireUser();
  const aal = await getAssuranceLevels();
  if (aal.currentLevel === "aal2") redirect(next);
  if (aal.nextLevel !== "aal2") redirect(`${SECURITY_PATH}?next=${encodeURIComponent(next)}`);

  return (
    <div className="space-y-4">
      <p className="text-sm">Open the authenticator app you set up for this account and enter the 6-digit code it shows.</p>
      <VerifyForm next={next} />
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Lost your phone or authenticator app? Contact support to reset two-factor for your account. Nobody from our team
        will ever ask you for a code.
      </p>
    </div>
  );
}
