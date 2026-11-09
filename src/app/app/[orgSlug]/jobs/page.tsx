import { requireOrgMembership } from "@/lib/auth";

export const metadata = { title: "Jobs · Assessment Platform" };

// Placeholder until skeleton step 3 (jobs, invites, invite emails).
export default async function JobsPage({ params }: PageProps<"/app/[orgSlug]/jobs">) {
  await requireOrgMembership((await params).orgSlug);
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Creating jobs and inviting candidates is coming next.</p>
    </div>
  );
}
