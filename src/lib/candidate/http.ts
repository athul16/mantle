import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./config";
import { looksLikeToken } from "./invite";
import { getCandidateSession, type CandidateSession } from "./session";

/**
 * Helpers for /api/candidate route handlers. They read the session from the
 * request itself (not next/headers), so tests can call handlers directly.
 * Forms get 303 redirects back to the /a pages; fetch() callers get JSON.
 */

export function wantsJson(req: NextRequest): boolean {
  return (req.headers.get("content-type") ?? "").includes("application/json");
}

/** Body fields as strings, from a form post or a JSON body. Bad bodies give {}. */
export async function readFields(req: NextRequest): Promise<Record<string, string>> {
  try {
    if (wantsJson(req)) {
      const body = (await req.json()) as unknown;
      if (!body || typeof body !== "object") return {};
      return Object.fromEntries(
        Object.entries(body).filter((e): e is [string, string | boolean] => typeof e[1] === "string" || typeof e[1] === "boolean").map(([k, v]) => [k, String(v)]),
      );
    }
    const form = await req.formData();
    return Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

export async function sessionFromRequest(req: NextRequest): Promise<CandidateSession | null> {
  return getCandidateSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** 303 to a page under /a/[token]. The token is checked so it can't redirect elsewhere. */
export function redirectToPage(req: NextRequest, token: string, page = "", query?: Record<string, string>) {
  const safe = looksLikeToken(token) ? token : "invalid";
  const url = new URL(`/a/${safe}${page ? `/${page}` : ""}`, req.url);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const unauthorized = () => json({ ok: false, error: "no_session" }, 401);
