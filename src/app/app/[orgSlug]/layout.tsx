import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { listMemberships, requireOrgMembership, requireUser } from "@/lib/auth";
import { OrgSwitcher } from "./org-switcher";

const NAV = [
  { path: "", label: "Dashboard" },
  { path: "/jobs", label: "Jobs" },
  { path: "/candidates", label: "Candidates" },
  { path: "/team", label: "Team" },
  { path: "/settings", label: "Settings" },
] as const;

// The shell renders statically. The company slug comes from the URL and the
// session from cookies, so both are read inside Suspense boundaries (required
// with cacheComponents); the params promise is passed down, not awaited here.
export default function OrgLayout({ children, params }: LayoutProps<"/app/[orgSlug]">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/app" className="font-semibold">Assessment Platform</Link>
            <Suspense fallback={<div className="h-5 w-64" />}>
              {params.then(({ orgSlug }) => (
                <nav className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-400">
                  {NAV.map((item) => (
                    <Link key={item.path} href={`/app/${orgSlug}${item.path}`} className="hover:text-neutral-900 dark:hover:text-white">
                      {item.label}
                    </Link>
                  ))}
                </nav>
              ))}
            </Suspense>
          </div>
          <Suspense fallback={<div className="h-8 w-48" />}>
            <AccountBar params={params} />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}

async function AccountBar({ params }: { params: LayoutProps<"/app/[orgSlug]">["params"] }) {
  const { orgSlug } = await params;
  const user = await requireUser();
  const active = await requireOrgMembership(orgSlug);
  const memberships = await listMemberships();
  return (
    <div className="flex items-center gap-3 text-sm">
      {memberships.length > 1 ? (
        <OrgSwitcher memberships={memberships} activeOrgId={active.orgId} />
      ) : (
        <span className="font-medium">{active.orgName}</span>
      )}
      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs capitalize text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        {active.role}
      </span>
      <span className="hidden text-neutral-500 sm:inline">{user.email}</span>
      <form action={signOut}>
        <button type="submit" className="text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
          Sign out
        </button>
      </form>
    </div>
  );
}
