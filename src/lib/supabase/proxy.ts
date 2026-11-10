import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

const AUTH_PAGES = ["/login", "/signup"];

// Refreshes the Supabase session cookie on every matched request and does an
// optimistic redirect for /app. Real authorization happens in pages/actions
// (src/lib/auth.ts) and in RLS.
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
  const orgSlug = user && (request.method === "GET" || request.method === "HEAD") ? pathname.match(/^\/app\/([^/]+)/)?.[1] : undefined;
  if (orgSlug && !(await isMemberOf(supabase, user!.id, orgSlug))) {
    const url = request.nextUrl.clone();
    // No route matches this path, so Next renders the root not-found page with a 404 status.
    url.pathname = "/_org-not-found";
    url.search = "";
    return rewriteWithCookies(url, response, 404);
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
async function isMemberOf(supabase: SupabaseClient<Database>, userId: string, orgSlug: string): Promise<boolean> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(orgSlug)) return false;
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, organizations!inner(slug)")
    .eq("user_id", userId)
    .eq("organizations.slug", orgSlug)
    .limit(1);
  // On a lookup error let the request through; the layout still checks.
  if (error) return true;
  return data.length > 0;
}

function rewriteWithCookies(url: URL, from: NextResponse, status: number) {
  const rewrite = NextResponse.rewrite(url, { status });
  for (const cookie of from.cookies.getAll()) rewrite.cookies.set(cookie);
  return rewrite;
}

// Keep any refreshed auth cookies when redirecting.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
