import type { NextRequest } from "next/server";
import { submitAttempt } from "@/lib/candidate/attempt";
import { json, readFields, redirectToPage, sessionFromRequest, unauthorized, wantsJson } from "@/lib/candidate/http";

/** Final submit from the review page. After the deadline it's recorded as a timeout. */
export async function POST(req: NextRequest) {
  const { token = "" } = await readFields(req);
  const session = await sessionFromRequest(req);
  if (!session) return wantsJson(req) ? unauthorized() : redirectToPage(req, token);

  const result = await submitAttempt(session);
  if (wantsJson(req)) return json(result, result.ok ? 200 : 409);
  return redirectToPage(req, token, result.ok ? "done" : "instructions");
}
