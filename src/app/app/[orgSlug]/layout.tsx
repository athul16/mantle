import Link from "next/link";
import { Suspense } from "react";
import { MantleMark } from "@/components/brand";
import { listMemberships, requireOrgMembership, requireUser } from "@/lib/auth";
import { AccountMenu, MainNav } from "./org-switcher";

// The company shell from the prototype: a 56px white header with the Mantle
// mark, top tabs (Jobs, Candidates, Assessments, Analytics soon) and the
// account menu. Each page sets its own content width.
//
// The shell renders statically. The company slug comes from the URL and the
// session from cookies, so both are read inside Suspense boundaries (required
// with cacheComponents); the params promise is passed down, not awaited here.
export default function OrgLayout({ children, params }: LayoutProps<"/app/[orgSlug]">) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}>
      <header
        style={{ height: 56, display: "flex", alignItems: "center", gap: 32, padding: "0 24px", background: "#fff", borderBottom: "1px solid var(--line)", position: "relative", zIndex: 50 }}
      >
        <Link href="/app" aria-label="Mantle home" style={{ textDecoration: "none" }}>
          <MantleMark />
        </Link>
        <Suspense fallback={<div style={{ width: 360 }} />}>
          {params.then(({ orgSlug }) => (
            <MainNav orgSlug={orgSlug} />
          ))}
        </Suspense>
        <span style={{ flex: 1 }} />
        <Suspense fallback={<div style={{ width: 180, height: 36 }} />}>
          <AccountBar params={params} />
        </Suspense>
      </header>
      <Suspense fallback={<p className="small muted" style={{ padding: "28px 32px" }}>Loading…</p>}>{children}</Suspense>
    </div>
  );
}

async function AccountBar({ params }: { params: LayoutProps<"/app/[orgSlug]">["params"] }) {
  const { orgSlug } = await params;
  const user = await requireUser();
  const active = await requireOrgMembership(orgSlug);
  const memberships = await listMemberships();
  return <AccountMenu email={user.email ?? ""} memberships={memberships} active={active} />;
}
