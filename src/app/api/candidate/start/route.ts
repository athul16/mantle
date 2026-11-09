import type { NextRequest } from "next/server";
import { startAttempt } from "@/lib/candidate/attempt";
import { json, readFields, redirectToPage, sessionFromRequest, unauthorized, wantsJson } from "@/lib/candidate/http";

/** "Start" on the instructions page: the server clock starts here. */
export async function POST(req: NextRequest) {
  const { token = "" } = await readFields(req);
  const session = await sessionFromRequest(req);
  if (!session) return wantsJson(req) ? unauthorized() : redirectToPage(req, token);

  const result = await startAttempt(session);
  if (wantsJson(req)) return json(result, result.ok ? 200 : 409);
  if (result.ok) return redirectToPage(req, token, "workspace");
  return redirectToPage(req, token, result.error === "expired" ? "" : "done");
}
