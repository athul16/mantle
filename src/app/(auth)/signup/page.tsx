import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/ui";
import { signup } from "../actions";
import { CredentialsForm } from "../credentials-form";

export const metadata = { title: "Create account · Mantle" };

export default function SignupPage() {
  return (
    <AuthCard
      title="Create a company account"
      intro="You'll set up your company next, then invite your team."
      footer={
        <>
          Already have an account? <Link href="/login" style={{ textDecoration: "underline" }}>Sign in</Link>
        </>
      }
      below={<p className="small muted" style={{ textAlign: "center" }}>Invited by a teammate? Use the link in your invite email instead.</p>}
    >
      <Suspense>
        <CredentialsForm action={signup} submitLabel="Create account" passwordAutoComplete="new-password" emailPlaceholder="you@company.com" />
      </Suspense>
    </AuthCard>
  );
}
