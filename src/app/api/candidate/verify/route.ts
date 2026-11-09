import type { NextRequest } from "next/server";
import { verifyCode } from "@/lib/candidate/code";
import { json, readFields, redirectToPage, wantsJson } from "@/lib/candidate/http";
import { sessionCookieHeaders } from "@/lib/candidate/session";

/** Verify page submit: name, code, consent. Success sets the session cookie. */
export async function POST(req: NextRequest) {
  const fields = await readFields(req);
  const token = fields.token ?? "";
  const result = await verifyCode({
    token,
    code: fields.code ?? "",
    name: fields.name ?? "",
    consent: fields.consent === "on" || fields.consent === "true",
  });

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

  const res = wantsJson(req) ? json({ ok: true, resumed: result.resumed }) : redirectToPage(req, token, "check");
  for (const cookie of sessionCookieHeaders(result.sessionToken)) res.headers.append("Set-Cookie", cookie);
  return res;
}
