import { requireOrgMembership } from "@/lib/auth";
import { readRetention } from "@/lib/retention/policy";
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
  const retention = readRetention(data.settings);
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
          Candidate data is deleted automatically on two clocks, both counted from when a candidate&apos;s assessment ends.
          Camera photos and screen screenshots go first. Results (the candidate, their answers, scores, integrity events, flags,
          notes and votes) go later. Candidates see both periods in the monitoring notice. You can also delete one
          candidate&apos;s data from their report at any time.
        </p>
        {isAdmin ? (
          <RetentionForm orgId={orgId} mediaDays={retention.mediaDays} resultsDays={retention.resultsDays} />
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Photos and screenshots are kept for {retention.mediaDays} days after the assessment ends.</li>
            <li>Results are kept for {retention.resultsDays} days after the assessment ends.</li>
          </ul>
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
