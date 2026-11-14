"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Avatar, CompanyLogo } from "@/components/brand";
import { Icon } from "@/components/icons";
import type { Membership } from "@/lib/auth";
import { switchOrg } from "./actions";

/** Top navigation tabs (.nav-top). The active tab follows the URL. */
export function MainNav({ orgSlug }: { orgSlug: string }) {
  const path = usePathname();
  const base = `/app/${orgSlug}`;
  const items = [
    { href: `${base}/jobs`, label: "Jobs", on: path.startsWith(`${base}/jobs`) && !path.startsWith(`${base}/jobs/assessments`) },
    { href: `${base}/candidates`, label: "Candidates", on: path.startsWith(`${base}/candidates`) },
    { href: `${base}/jobs/assessments`, label: "Assessments", on: path.startsWith(`${base}/jobs/assessments`) },
  ];
  return (
    <nav aria-label="Main" style={{ display: "flex", gap: 22, alignSelf: "stretch" }}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.on ? "nav-top on" : "nav-top"} aria-current={i.on ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
      <span className="nav-top" style={{ gap: 6, cursor: "default" }} aria-disabled="true">
        Analytics <span className="soon">Soon</span>
      </span>
    </nav>
  );
}

/** The avatar button and account menu: who's signed in, company switcher, Team, Settings, two-factor, sign out. */
export function AccountMenu({ email, memberships, active }: { email: string; memberships: Membership[]; active: Membership }) {
  const path = usePathname();
  // Remember the page the menu was opened on, so it closes after navigating.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((typeof next === "function" ? next(open) : next) ? path : null);
  const ref = useRef<HTMLDivElement>(null);
  const base = `/app/${active.orgSlug}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenOn(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ gap: 8, padding: "0 6px", background: open ? "var(--subtle)" : undefined }}
      >
        <Avatar name={email} />
        <span className="small">{active.orgName}</span>
        <Icon name="chevD" className="i-sm" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="modal"
          style={{ position: "absolute", top: 48, right: -4, width: 280, border: "1px solid var(--line)", padding: 6, zIndex: 400, animation: "rise .14s ease-out" }}
        >
          <div style={{ padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="small strong" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{email}</span>
            <span className="xs muted" style={{ textTransform: "capitalize" }}>{active.role}</span>
          </div>
          {memberships.length > 1 ? (
            <>
              <div className="divider" style={{ margin: "4px 0" }} />
              <span className="eyebrow" style={{ padding: "6px 10px 2px", display: "block" }}>Company</span>
              {memberships.map((m) => {
                const on = m.orgId === active.orgId;
                return (
                  <form key={m.orgId} action={switchOrg}>
                    <input type="hidden" name="orgId" value={m.orgId} />
                    <button
                      type="submit"
                      role="menuitemradio"
                      aria-checked={on}
                      className="nav-a"
                      style={{ width: "100%", border: 0, background: on ? "var(--subtle)" : "none", cursor: "pointer" }}
                    >
                      <CompanyLogo name={m.orgName} size={20} />
                      {m.orgName}
                      {on ? <Icon name="check" className="i-sm" /> : null}
                    </button>
                  </form>
                );
              })}
            </>
          ) : null}
          <div className="divider" style={{ margin: "4px 0" }} />
          <Link role="menuitem" className={path.startsWith(`${base}/team`) ? "nav-a on" : "nav-a"} href={`${base}/team`} onClick={() => setOpenOn(null)}>
            <Icon name="users" />
            Team
          </Link>
          <Link role="menuitem" className={path.startsWith(`${base}/settings`) ? "nav-a on" : "nav-a"} href={`${base}/settings`} onClick={() => setOpenOn(null)}>
            <Icon name="sliders" />
            Settings
          </Link>
          <Link role="menuitem" className="nav-a" href="/app/account/security" onClick={() => setOpenOn(null)}>
            <Icon name="shield" />
            Two-factor authentication
          </Link>
          <div className="divider" style={{ margin: "4px 0" }} />
          <form action={signOut}>
            <button type="submit" role="menuitem" className="nav-a" style={{ width: "100%", border: 0, background: "none", cursor: "pointer" }}>
              <Icon name="logout" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
