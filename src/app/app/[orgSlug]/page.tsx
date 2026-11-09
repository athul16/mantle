import Link from "next/link";
import { requireOrgMembership } from "@/lib/auth";

export const metadata = { title: "Dashboard · Assessment Platform" };

export default async function DashboardPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const { orgName, role } = await requireOrgMembership(orgSlug);
  const base = `/app/${orgSlug}`;
  const cards = [
    { href: `${base}/jobs`, title: "Jobs", body: "Hiring rounds and the assessment each one uses." },
    { href: `${base}/candidates`, title: "Candidates", body: "Invites, scores, and integrity labels, ranked." },
    { href: `${base}/team`, title: "Team", body: role === "admin" ? "Invite recruiters and hiring managers." : "See who's on your team." },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{orgName}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          You&apos;re signed in as <span className="capitalize">{role}</span>.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600">
            <h2 className="font-medium">{c.title}</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
