import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/ui";
import { login } from "../actions";
import { CredentialsForm } from "../credentials-form";

export const metadata = { title: "Sign in · Assessment Platform" };

export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New here? <Link href="/signup" className="underline">Create a company account</Link>
        </>
      }
    >
      <Suspense>
        <CredentialsForm action={login} submitLabel="Sign in" passwordAutoComplete="current-password" />
      </Suspense>
    </AuthCard>
  );
}
