import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/ui";
import { signup } from "../actions";
import { CredentialsForm } from "../credentials-form";

export const metadata = { title: "Create account · Assessment Platform" };

export default function SignupPage() {
  return (
    <AuthCard
      title="Create a company account"
      footer={
        <>
          Already have an account? <Link href="/login" className="underline">Sign in</Link>
          <br />
          Invited by a teammate? Use the link in your invite email instead.
        </>
      }
    >
      <Suspense>
        <CredentialsForm action={signup} submitLabel="Create account" passwordAutoComplete="new-password" />
      </Suspense>
    </AuthCard>
  );
}
