import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// /app/<slug> has no page of its own (the prototype has no dashboard). Redirect
// over HTTP so the browser never renders it and then jumps client-side, which
// can interrupt whatever navigation comes next. Membership is checked on /jobs.
const ORG_HOME = /^\/app\/([^/]+)\/?$/;

export async function proxy(request: NextRequest) {
  const home = ORG_HOME.exec(request.nextUrl.pathname);
  if (home && home[1] !== "account") {
    const url = request.nextUrl.clone();
    url.pathname = `/app/${home[1]}/jobs`;
    return NextResponse.redirect(url);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except: Next internals, static files, candidate routes
    // (/a/* and /api/candidate/*), which never use company sessions, and the
    // self-hosted MediaPipe runtime and model (/mediapipe/*: wasm, .task).
    "/((?!_next/static|_next/image|favicon.ico|a/|api/candidate/|mediapipe/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|task)$).*)",
  ],
};
