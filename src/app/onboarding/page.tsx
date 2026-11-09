import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/ui";
import { listMemberships, requireUser } from "@/lib/auth";
import { CreateOrgForm } from "./create-org-form";

export const metadata = { title: "Set up your company · Assessment Platform" };

export default function OnboardingPage() {
  return (
    <AuthCard title="Set up your company">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        You&apos;ll be the admin. You can invite recruiters and hiring managers next.
      </p>
      <Suspense>
        <ExistingOrgs />
      </Suspense>
      <CreateOrgForm />
    </AuthCard>
  );
}

async function ExistingOrgs() {
  await requireUser();
  const memberships = await listMemberships();
  if (memberships.length === 0) return null;
  return (
    <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">
      You already belong to {memberships.map((m) => m.orgName).join(", ")}.{" "}
      <Link href="/app" className="underline">Go to your dashboard</Link> or create another company below.
    </p>
  );
}
