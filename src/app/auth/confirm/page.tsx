import { Suspense } from "react";
import { AuthCard } from "@/components/ui";
import { ConfirmForm } from "./confirm-form";

export const metadata = { title: "Confirm · Assessment Platform" };

/**
 * Landing page for Supabase email links: teammate invites
 * (`?token_hash=…&type=invite`) and sign-up confirmation
 * (`?token_hash=…&type=email`, or `?code=…`). Opening it uses nothing up: link
 * scanners (Microsoft Safe Links) open links before people do. Only the button
 * (a POST to confirmLink) verifies the token. See supabase/templates/.
 */
export default function ConfirmPage() {
  return (
    <AuthCard title="Almost there">
      <Suspense>
        <ConfirmForm />
      </Suspense>
    </AuthCard>
  );
}
