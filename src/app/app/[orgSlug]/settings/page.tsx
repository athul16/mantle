import { requireOrgMembership } from "@/lib/auth";
import { readRetentionDays } from "@/lib/retention/policy";
import { createClient } from "@/lib/supabase/server";
import { readContactEmail } from "@/lib/org-settings";
import { ContactEmailForm } from "./contact-email-form";
import { RetentionForm } from "./retention-form";

export const metadata = { title: "Settings · Assessment Platform" };

const muted = "text-neutral-600 dark:text-neutral-400";

// Org settings. Every member can see them; only admins can change them.
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgId, orgName, role } = await requireOrgMembership((await params).orgSlug);
  const db = await createClient();
  const { data, error } = await db.from("organizations").select("settings").eq("id", orgId).single();
  if (error) throw error;
  const days = readRetentionDays(data.settings);
  const isAdmin = role === "admin";
  const contactEmail = readContactEmail(data.settings);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className={`text-sm ${muted}`}>
          Settings for {orgName}.{isAdmin ? "" : " Only admins can change them."}
        </p>
      </div>

      <section aria-labelledby="retention-heading" className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 id="retention-heading" className="font-medium">Candidate data retention</h2>
        <p className={`text-sm ${muted}`}>
          Answers, scores, notes, integrity events and proctoring snapshots are deleted automatically this many days after a
          candidate&apos;s assessment ends. Candidates see this period in the monitoring notice. You can also delete one
          candidate&apos;s data from their report at any time.
        </p>
        {isAdmin ? (
          <RetentionForm orgId={orgId} days={days} />
        ) : (
          <p className="text-sm">
            Candidate data is kept for {days} days after the assessment ends.
          </p>
        )}
      </section>

      <section aria-labelledby="contact-heading" className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 id="contact-heading" className="font-medium">Candidate contact</h2>
        <p className={`text-sm ${muted}`}>
          Candidates see this address in the monitoring notice and on the verify page, so they know whom to ask for extra time or
          to take the test without a camera or screen share. Recruiters set those accommodations per invite on the job page.
        </p>
        {isAdmin ? (
          <ContactEmailForm orgId={orgId} email={contactEmail} />
        ) : (
          <p className="text-sm">{contactEmail ? `Candidates are told to contact ${contactEmail}.` : "No contact email is set."}</p>
        )}
      </section>
    </div>
  );
}
