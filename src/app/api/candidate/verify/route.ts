import type { NextRequest } from "next/server";
import { verifyCode } from "@/lib/candidate/code";
import { json, readFields, redirectToPage, wantsJson } from "@/lib/candidate/http";
import { getCandidateSession, sessionCookieHeaders } from "@/lib/candidate/session";
import { isMonitored } from "@/lib/proctoring/config";
import { getProctoringSettings, recordConsent } from "@/lib/proctoring/server";

/**
 * Verify page submit: name, code, consent. Success sets the session cookie.
 *
 * The verify page shows the full monitoring notice (what is recorded, why, who
 * sees it, how long) next to the one consent box, so when the assessment uses
 * the camera or screen, ticking it is also the agreement to monitoring: it is
 * recorded here, in the same request, and the system check doesn't ask again.
 */
export async function POST(req: NextRequest) {
  const fields = await readFields(req);
  const token = fields.token ?? "";
  const consent = fields.consent === "on" || fields.consent === "true";
  const result = await verifyCode({ token, code: fields.code ?? "", name: fields.name ?? "", consent });

  if (!result.ok) {
    if (wantsJson(req)) return json(result, 400);
    if (["invalid", "revoked", "expired", "completed"].includes(result.error)) {
      return redirectToPage(req, token, "", { error: result.error });
    }
    return redirectToPage(req, token, "verify", {
      error: result.error,
      ...(result.triesLeft !== undefined ? { left: String(result.triesLeft) } : {}),
    });
  }

  if (consent) {
    const session = await getCandidateSession(result.sessionToken);
    if (session && isMonitored(await getProctoringSettings(session))) await recordConsent(session);
  }

  const res = wantsJson(req) ? json({ ok: true, resumed: result.resumed }) : redirectToPage(req, token, "check");
  for (const cookie of sessionCookieHeaders(result.sessionToken)) res.headers.append("Set-Cookie", cookie);
  return res;
}
