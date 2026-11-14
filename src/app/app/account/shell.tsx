import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { AccountMenu, MainNav } from "@/app/app/[orgSlug]/org-switcher";
import { MantleMark } from "@/components/brand";
import { ACTIVE_ORG_COOKIE, listMemberships, requireUser } from "@/lib/auth";

/**
 * The company header (same as /app/[orgSlug]/layout.tsx) for account pages,
 * which aren't under a company URL. Uses the remembered company, or the first;
 * someone with no company gets the mark and a sign-out link.
 */
export async function AccountShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const memberships = await listMemberships();
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.orgId === preferred) ?? memberships[0];
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}>
      <header
        style={{ height: 56, display: "flex", alignItems: "center", gap: 32, padding: "0 24px", background: "#fff", borderBottom: "1px solid var(--line)", position: "relative", zIndex: 50 }}
      >
        <Link href="/app" aria-label="Mantle home" style={{ textDecoration: "none" }}>
          <MantleMark />
        </Link>
        {active ? <MainNav orgSlug={active.orgSlug} /> : null}
        <span style={{ flex: 1 }} />
        {active ? (
          <AccountMenu email={user.email ?? ""} memberships={memberships} active={active} />
        ) : (
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost btn-sm">Sign out</button>
          </form>
        )}
      </header>
      {children}
    </div>
  );
}
