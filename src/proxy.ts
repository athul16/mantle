import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except: Next internals, static files, and candidate routes
    // (/a/* and /api/candidate/*), which never use company sessions.
    "/((?!_next/static|_next/image|favicon.ico|a/|api/candidate/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
