import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { mfaGate, mfaRedirectPath } from "@/app/app/account/mfa-gate";
import type { Database } from "@/lib/database.types";

const AUTH_PAGES = ["/login", "/signup"];

// Refreshes the Supabase session cookie on every matched request and does an
// optimistic redirect for /app. Real authorization happens in pages/actions
// (src/lib/auth.ts) and in RLS. Company admins below aal2 are sent to set up
// or enter two-factor here, before any company page renders.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Do not put code between createServerClient and getUser(): getUser() is
  // what refreshes an expired session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && (pathname === "/app" || pathname.startsWith("/app/") || pathname === "/onboarding")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, response);
  }

  // Another company's URL (or one that doesn't exist) must answer HTTP 404.
  // The /app/[orgSlug] layout also calls notFound(), but by then the static
  // shell has streamed with a 200, so the status has to be decided here.
  // /app/account/* is the user's own account (two-factor setup), not a company.
  const slugInPath = pathname.match(/^\/app\/([^/]+)/)?.[1];
  const orgSlug = user && (request.method === "GET" || request.method === "HEAD") && slugInPath !== "account" ? slugInPath : undefined;
  const role = orgSlug ? await roleIn(supabase, user!.id, orgSlug) : undefined;
  if (orgSlug && role === null) return notFoundRewrite(request, response);

  // Admins must be at aal2 (password + authenticator code). Decided before the
  // page's own lookups so an aal1 session learns nothing about the company's
  // jobs or candidates. Server actions (POST) are checked in requireMembership.
  if (orgSlug && role === "admin") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const gate = mfaGate(role, { currentLevel: aal?.currentLevel ?? null, nextLevel: aal?.nextLevel ?? null });
    if (gate !== "ok") {
      // A server action's redirect (e.g. login → next) renders its target with
      // an internal fetch, marked by the forwarded x-action-redirect header,
      // that would follow this redirect but leave the browser on the old URL.
      // Answer it with no RSC payload instead, so the browser navigates there
      // itself and gets the redirect below.
      if (request.headers.has("x-action-redirect")) {
        return withCookies(new NextResponse(null, { status: 204 }), response);
      }
      const url = request.nextUrl.clone();
      const [path, query] = mfaRedirectPath(gate, pathname + search).split("?");
      url.pathname = path;
      url.search = `?${query}`;
      return redirectWithCookies(url, response);
    }
  }

  // Same for a job id that isn't one of this company's jobs (another
  // company's, deleted, or malformed): the job page's notFound() comes too late.
  const jobId = orgSlug ? pathname.match(/^\/app\/[^/]+\/jobs\/([^/]+)\/?$/)?.[1] : undefined;
  if (jobId && jobId !== "assessments" && !(await isRowOf(supabase, "jobs", orgSlug!, jobId))) {
    return notFoundRewrite(request, response);
  }

  // And a candidate report for an invite that isn't this company's.
  const inviteId = orgSlug ? pathname.match(/^\/app\/[^/]+\/candidates\/([^/]+)\/?$/)?.[1] : undefined;
  if (inviteId && !(await isRowOf(supabase, "invites", orgSlug!, inviteId))) {
    return notFoundRewrite(request, response);
  }

  if (user && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

// Same rule as requireOrgMembership: the user's own client, so RLS decides.
// The user's role in the company, null if they aren't a member, undefined if
// the lookup failed (let the request through; the layout still checks both
// membership and two-factor).
async function roleIn(supabase: SupabaseClient<Database>, userId: string, orgSlug: string): Promise<string | null | undefined> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(orgSlug)) return null;
  const { data, error } = await supabase
    .from("memberships")
    .select("role, organizations!inner(slug)")
    .eq("user_id", userId)
    .eq("organizations.slug", orgSlug)
    .limit(1);
  if (error) return undefined;
  return data[0]?.role ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RLS limits jobs and invites to the user's companies; the slug filter limits it to this one.
async function isRowOf(supabase: SupabaseClient<Database>, table: "jobs" | "invites", orgSlug: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { data, error } = await supabase
    .from(table)
    .select("id, organizations!inner(slug)")
    .eq("id", id)
    .eq("organizations.slug", orgSlug)
    .limit(1);
  // On a lookup error let the request through; the page still checks.
  if (error) return true;
  return data.length > 0;
}

// No route matches this path, so Next renders the root not-found page with a 404 status.
function notFoundRewrite(request: NextRequest, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = "/_org-not-found";
  url.search = "";
  return rewriteWithCookies(url, from, 404);
}

function rewriteWithCookies(url: URL, from: NextResponse, status: number) {
  const rewrite = NextResponse.rewrite(url, { status });
  for (const cookie of from.cookies.getAll()) rewrite.cookies.set(cookie);
  return rewrite;
}

function withCookies(to: NextResponse, from: NextResponse) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

// Keep any refreshed auth cookies when redirecting.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
