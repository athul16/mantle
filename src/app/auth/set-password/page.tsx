import { Suspense } from "react";
import { CompanyLogo } from "@/components/brand";
import { AuthCard } from "@/components/ui";
import { listMemberships } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password · Mantle" };

// First visit for a teammate invited from the Team page (and password
// recovery). The company and role come from the membership the invite created.
export default function SetPasswordPage() {
  return (
    <Suspense fallback={<AuthCard title="Set your password"><p className="small ink2">Loading…</p></AuthCard>}>
      <SetPassword />
    </Suspense>
  );
}

async function SetPassword() {
  const memberships = await listMemberships();
  const org = memberships[0];
  return (
    <AuthCard
      title="Set your password"
      icon={
        org ? (
          <div className="row g10">
            <CompanyLogo name={org.orgName} size={32} />
            <span className="strong">{org.orgName}</span>
          </div>
        ) : undefined
      }
      intro={
        org ? (
          <>
            You were invited to {org.orgName} as a <strong style={{ textTransform: "capitalize" }}>{org.role}</strong>. Choose a password to finish.
          </>
        ) : (
          "You were invited to a company account. Choose a password to finish."
        )
      }
    >
      <SetPasswordForm />
    </AuthCard>
  );
}
