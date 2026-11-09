import { requireActiveMembership } from "@/lib/auth";

export const metadata = { title: "Candidates · Assessment Platform" };

// Placeholder until the results table (skeleton step 6).
export default async function CandidatesPage() {
  await requireActiveMembership();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">The ranked candidates table will live here.</p>
    </div>
  );
}
